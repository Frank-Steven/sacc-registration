#include "data/validation.h"

#include <cctype>
#include <cerrno>
#include <cstdlib>
#include <map>
#include <sqlite3.h>
#include <string>
#include <vector>

#include "config/authz.h"

namespace sacc {

namespace {

// ==================== 受限正则匹配器 ====================
// wasm 为 -fno-exceptions 构建，std::regex 构造会抛异常（terminate），故自实现
// 支持子集：字面 / 转义 / . / \d \D \w \W \s \S / [..] [^..]（含 a-z 范围）/
// 量词 * + ? {n} {n,} {n,m} / 锚点 ^ $（仅首尾位置）；整串匹配（递归回溯）。

enum class NodeType { kChar, kAny, kClass, kNotClass, kDigit, kWord, kSpace };

struct Node {
  NodeType type;
  char ch = 0;          // kChar
  std::string chars;    // kClass / kNotClass（展开的字符集合）
  bool negate = false;  // \D \W \S
  int min = 1;          // 量词下界
  int max = 1;          // 量词上界（-1 = 无限）
};

bool is_digit_char(char c) { return c >= '0' && c <= '9'; }
bool is_word_char(char c) { return is_digit_char(c) || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '_'; }
bool is_space_char(char c) { return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f' || c == '\v'; }

bool parse_pattern(const std::string& p, std::vector<Node>& nodes) {
  size_t i = 0;
  while (i < p.size()) {
    Node n;
    if (p[i] == '\\') {
      if (i + 1 >= p.size()) return false;
      const char c = p[i + 1];
      switch (c) {
        case 'd': n = {NodeType::kDigit}; break;
        case 'D': n = {NodeType::kDigit, 0, {}, true}; break;
        case 'w': n = {NodeType::kWord}; break;
        case 'W': n = {NodeType::kWord, 0, {}, true}; break;
        case 's': n = {NodeType::kSpace}; break;
        case 'S': n = {NodeType::kSpace, 0, {}, true}; break;
        default: n = {NodeType::kChar, c}; break;  // 转义字面字符
      }
      i += 2;
    } else if (p[i] == '.') {
      n = {NodeType::kAny};
      i += 1;
    } else if (p[i] == '[') {
      size_t j = i + 1;
      bool neg = false;
      if (j < p.size() && p[j] == '^') {
        neg = true;
        j += 1;
      }
      std::string chars;
      bool closed = false;
      while (j < p.size()) {
        if (p[j] == ']' && !chars.empty()) {
          closed = true;
          break;
        }
        if (j + 2 < p.size() && p[j + 1] == '-' && p[j + 2] != ']') {
          const char lo = p[j], hi = p[j + 2];
          if (lo > hi) return false;
          for (char c = lo; c <= hi; ++c) chars.push_back(c);
          j += 3;
        } else if (p[j] == '\\' && j + 1 < p.size()) {
          chars.push_back(p[j + 1]);
          j += 2;
        } else {
          chars.push_back(p[j]);
          j += 1;
        }
      }
      if (!closed) return false;
      n = {neg ? NodeType::kNotClass : NodeType::kClass, 0, std::move(chars)};
      i = j + 1;
    } else if (p[i] == '^' && i == 0) {
      i += 1;  // 开头锚点：整串匹配从位置 0 开始，等价于 ^
      continue;
    } else if (p[i] == '$' && i == p.size() - 1) {
      i += 1;  // 末尾锚点：整串匹配要求匹配到结尾，等价于 $
      continue;
    } else {
      n = {NodeType::kChar, p[i]};
      i += 1;
    }
    // 量词
    if (i < p.size() && (p[i] == '*' || p[i] == '+' || p[i] == '?')) {
      if (p[i] == '*') {
        n.min = 0;
        n.max = -1;
      } else if (p[i] == '+') {
        n.min = 1;
        n.max = -1;
      } else {
        n.min = 0;
        n.max = 1;
      }
      i += 1;
    } else if (i < p.size() && p[i] == '{') {
      size_t j = i + 1;
      size_t lo = 0;
      bool digit = false;
      while (j < p.size() && is_digit_char(p[j])) {
        lo = lo * 10 + static_cast<size_t>(p[j] - '0');
        digit = true;
        j += 1;
      }
      if (!digit) return false;
      if (j < p.size() && p[j] == '}') {
        n.min = static_cast<int>(lo);
        n.max = n.min;
        i = j + 1;
      } else if (j < p.size() && p[j] == ',') {
        j += 1;
        size_t hi = 0;
        bool has_hi = false;
        while (j < p.size() && is_digit_char(p[j])) {
          hi = hi * 10 + static_cast<size_t>(p[j] - '0');
          has_hi = true;
          j += 1;
        }
        if (j >= p.size() || p[j] != '}') return false;
        n.min = static_cast<int>(lo);
        n.max = has_hi ? static_cast<int>(hi) : -1;
        if (n.max != -1 && n.max < n.min) return false;
        i = j + 1;
      } else {
        return false;
      }
    }
    nodes.push_back(n);
  }
  return true;
}

bool node_match(const Node& n, char c) {
  switch (n.type) {
    case NodeType::kChar: return c == n.ch;
    case NodeType::kAny: return true;
    case NodeType::kDigit: return is_digit_char(c) != n.negate;
    case NodeType::kWord: return is_word_char(c) != n.negate;
    case NodeType::kSpace: return is_space_char(c) != n.negate;
    case NodeType::kClass: return n.chars.find(c) != std::string::npos;
    case NodeType::kNotClass: return n.chars.find(c) == std::string::npos;
  }
  return false;
}

// 递归回溯匹配深度上限：wasm 栈有限（-z stack-size=1MB），恶意超长输入 + 贪婪量词
// 会线性加深递归致栈溢出（wasm trap / 单实例宿主不可用）；超限按"不匹配"安全失败。
constexpr int kMaxMatchDepth = 4000;

bool match_at(const std::vector<Node>& nodes, size_t ni, const std::string& t, size_t ti,
              int depth);

// 匹配第 ni 个节点 count 次（当前已匹配 count 次）后继续
bool match_rep(const std::vector<Node>& nodes, size_t ni, const std::string& t, size_t ti,
               int count, int depth) {
  if (depth > kMaxMatchDepth) return false;
  const Node& n = nodes[ni];
  if (count < n.min) {
    if (ti < t.size() && node_match(n, t[ti])) {
      return match_rep(nodes, ni, t, ti + 1, count + 1, depth + 1);
    }
    return false;
  }
  // count 已达下界：可继续消费（贪心 + 回溯）或停止进入下一节点
  if (n.max < 0 || count < n.max) {
    if (ti < t.size() && node_match(n, t[ti]) &&
        match_rep(nodes, ni, t, ti + 1, count + 1, depth + 1)) {
      return true;
    }
  }
  return match_at(nodes, ni + 1, t, ti, depth + 1);
}

bool match_at(const std::vector<Node>& nodes, size_t ni, const std::string& t, size_t ti,
              int depth) {
  if (depth > kMaxMatchDepth) return false;
  if (ni == nodes.size()) return ti == t.size();  // 整串匹配
  return match_rep(nodes, ni, t, ti, 0, depth);
}

// ==================== 字段值类型判定 ====================

bool value_empty(const nlohmann::json& v) {
  if (v.is_null()) return true;
  if (v.is_string()) return v.get_ref<const std::string&>().empty();
  return false;
}

// 数字：JSON number 或纯数字字符串
bool parse_number(const nlohmann::json& v, std::int64_t& out) {
  if (v.is_number_integer()) {
    out = v.get<std::int64_t>();
    return true;
  }
  if (v.is_number_unsigned()) {
    out = static_cast<std::int64_t>(v.get<std::uint64_t>());
    return true;
  }
  if (v.is_string()) {
    const std::string& s = v.get_ref<const std::string&>();
    if (s.empty()) return false;
    errno = 0;
    char* end = nullptr;
    const long long lv = std::strtoll(s.c_str(), &end, 10);
    // 审查 Issue 7：检查 ERANGE，超长数字串（溢出钳制）不通过
    if (errno == ERANGE || end != s.c_str() + s.size()) return false;
    out = static_cast<std::int64_t>(lv);
    return true;
  }
  return false;
}

// 日期：YYYY-MM-DD
bool is_date_str(const std::string& s) {
  if (s.size() != 10 || s[4] != '-' || s[7] != '-') return false;
  for (int i = 0; i < 10; ++i) {
    if (i == 4 || i == 7) continue;
    if (!is_digit_char(s[i])) return false;
  }
  return true;
}

// 单选 / 多选选项合法性（options 为 JSON 数组字符串）
bool option_allowed(const std::string& options_s, const nlohmann::json& v, bool multi) {
  nlohmann::json opts;
  if (options_s.empty() || !json_parse_lenient(options_s, opts) || !opts.is_array()) {
    return true;  // 无选项配置则放行（类型正确性由配置侧保证）
  }
  const auto contains = [&](const nlohmann::json& item) {
    for (const auto& o : opts) {
      if (o == item) return true;
    }
    return false;
  };
  if (!multi) {
    return contains(v);
  }
  // 多选：值须为数组（或数组 JSON 字符串）
  nlohmann::json arr = v;
  if (v.is_string() && !json_parse_lenient(v.get_ref<const std::string&>(), arr)) return false;
  if (!arr.is_array()) return false;
  for (const auto& item : arr) {
    if (!contains(item)) return false;
  }
  return true;
}

// 取提交值（fields 为 [{field_id, value}]）；缺失时视为空
const nlohmann::json* find_value(const nlohmann::json& fields, std::int64_t field_id) {
  for (const auto& it : fields) {
    if (it.value("field_id", std::int64_t{0}) == field_id) {
      static const nlohmann::json kEmpty = nlohmann::json("");
      return it.contains("value") ? &it["value"] : &kEmpty;
    }
  }
  return nullptr;
}

} // namespace

bool match_pattern(const std::string& pattern, const std::string& text) {
  std::vector<Node> nodes;
  if (!parse_pattern(pattern, nodes)) return false;
  return match_at(nodes, 0, text, 0, 0);
}

std::string validate_submit_fields(Db& db, std::int64_t activity_id, const nlohmann::json& fields) {
  // 收集活动可见字段（form / field 均未软删且 is_visible=1）
  nlohmann::json fields_rows;
  std::string qerr;
  if (db.query(
          "SELECT f.field_id, f.field_key, f.field_label, f.field_type, f.is_required, "
          "f.options, f.validation FROM form_field f "
          "JOIN form fm ON f.form_id = fm.form_id "
          "WHERE fm.activity_id = ? AND fm.is_deleted = 0 AND f.is_deleted = 0 "
          "AND f.is_visible = 1 ORDER BY fm.sort_order, f.sort_order, f.field_id;",
          nlohmann::json::array({activity_id}), fields_rows, qerr) != SQLITE_OK) {
    return "数据库查询失败";
  }

  // 提交了不存在的字段 / 已删字段 → 拒绝
  for (const auto& it : fields) {
    const std::int64_t fid = it.value("field_id", std::int64_t{0});
    if (fid <= 0) continue;
    bool known = false;
    for (const auto& f : fields_rows) {
      if (f["field_id"].get<std::int64_t>() == fid) {
        known = true;
        break;
      }
    }
    if (!known) return "提交了无效字段";
  }

  for (const auto& f : fields_rows) {
    const std::int64_t fid = f["field_id"].get<std::int64_t>();
    const std::string label = f.value("field_label", "");
    const int type = f.value("field_type", 0);
    const bool required = f.value("is_required", 0) != 0;
    const nlohmann::json* vp = find_value(fields, fid);
    const nlohmann::json& v = vp ? *vp : nlohmann::json("");

    if (required && value_empty(v)) return "「" + label + "」为必填项";
    if (value_empty(v)) continue;  // 选填且未填 → 跳过

    if (type == 1) {  // 数字
      std::int64_t num = 0;
      if (!parse_number(v, num)) return "「" + label + "」须为数字";
      nlohmann::json rule;
      const std::string vs = f.value("validation", "");
      if (!vs.empty() && json_parse_lenient(vs, rule) && rule.is_object()) {
        if (rule.contains("min") && num < rule["min"].get<std::int64_t>())
          return "「" + label + "」不得小于 " + std::to_string(rule["min"].get<std::int64_t>());
        if (rule.contains("max") && num > rule["max"].get<std::int64_t>())
          return "「" + label + "」不得大于 " + std::to_string(rule["max"].get<std::int64_t>());
      }
    } else if (type == 4) {  // 日期
      if (!is_date_str(v.is_string() ? v.get_ref<const std::string&>() : ""))
        return "「" + label + "」须为 YYYY-MM-DD 日期";
    } else if (type == 2) {  // 单选
      if (!option_allowed(f.value("options", ""), v, false)) return "「" + label + "」选项不合法";
    } else if (type == 3) {  // 多选
      if (!option_allowed(f.value("options", ""), v, true)) return "「" + label + "」选项不合法";
      nlohmann::json arr;
      if (v.is_string()) {
        if (!json_parse_lenient(v.get_ref<const std::string&>(), arr)) arr = nlohmann::json::array();
      } else {
        arr = v;
      }
      const int count = arr.is_array() ? static_cast<int>(arr.size()) : 0;
      nlohmann::json rule;
      const std::string vs = f.value("validation", "");
      if (!vs.empty() && json_parse_lenient(vs, rule) && rule.is_object()) {
        if (rule.contains("min_items") && count < rule["min_items"].get<int>())
          return "「" + label + "」至少选择 " + std::to_string(rule["min_items"].get<int>()) + " 项";
        if (rule.contains("max_items") && count > rule["max_items"].get<int>())
          return "「" + label + "」最多选择 " + std::to_string(rule["max_items"].get<int>()) + " 项";
      }
    } else if (type == 0) {  // 文本：长度与正则
      const std::string s = v.is_string() ? v.get_ref<const std::string&>() : "";
      nlohmann::json rule;
      const std::string vs = f.value("validation", "");
      if (!vs.empty() && json_parse_lenient(vs, rule) && rule.is_object()) {
        if (rule.contains("min_length") &&
            static_cast<int>(s.size()) < rule["min_length"].get<int>())
          return "「" + label + "」长度不得少于 " + std::to_string(rule["min_length"].get<int>()) + " 字符";
        if (rule.contains("max_length") &&
            static_cast<int>(s.size()) > rule["max_length"].get<int>())
          return "「" + label + "」长度不得多于 " + std::to_string(rule["max_length"].get<int>()) + " 字符";
        if (rule.contains("regex") && rule["regex"].is_string() &&
            !match_pattern(rule["regex"].get<std::string>(), s))
          return "「" + label + "」格式不正确";
      }
    }
    // type 5 文件：非空路径 / URL 即放行
  }
  return "";
}

} // namespace sacc
