/* ./frontend/src/App.jsx */
import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { Layout, Typography, Menu, message } from 'antd';
import axios from 'axios';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';
import './App.css';

const { Header, Content } = Layout;
const { Title } = Typography;

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

function AppContent() {
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const location = useLocation();

  useEffect(() => {
    fetchCompanies();
  }, []);

  const fetchCompanies = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API_URL}/companies/`);
      setCompanies(response.data);
    } catch (error) {
      console.error(error);
      message.error("Failed to load companies.");
    } finally {
      setLoading(false);
    }
  };

  const activeMenu = location.pathname === '/settings' ? 'settings' : 'dashboard';

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ display: 'flex', alignItems: 'center', padding: '0 20px' }}>
        <Title level={4} style={{ color: 'white', margin: '0 20px 0 0' }}>Money Total Sheet</Title>
        <Menu 
          theme="dark" 
          mode="horizontal" 
          selectedKeys={[activeMenu]} 
          style={{ flex: 1 }}
          items={[
            { key: 'dashboard', label: <Link to="/">Dashboard</Link> },
            { key: 'settings', label: <Link to="/settings">Settings</Link> },
          ]}
        />
      </Header>
      
      <Content style={{ padding: '24px 50px', background: '#f5f5f5' }}>
        <div style={{ background: '#fff', padding: 24, minHeight: 400, borderRadius: 8 }}>
          <Routes>
            <Route path="/" element={<Dashboard companies={companies} loading={loading} />} />
            <Route path="/settings" element={<Settings companies={companies} fetchCompanies={fetchCompanies} />} />
          </Routes>
        </div>
      </Content>
    </Layout>
  );
}

export default function App() {
  return (
    <Router>
      <AppContent />
    </Router>
  );
}