#include "core/util.h"

#include <ctime>

namespace sacc {

std::int64_t now_ts() { return static_cast<std::int64_t>(::time(nullptr)); }

} // namespace sacc
