import { Layout } from 'antd';
import Home from './pages/Home/index.jsx';

const { Header, Content } = Layout;

export default function App() {
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ color: '#fff', fontSize: 18 }}>SACC 报名系统</Header>
      <Content style={{ padding: 24, maxWidth: 720, margin: '0 auto', width: '100%' }}>
        <Home />
      </Content>
    </Layout>
  );
}
