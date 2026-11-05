/* ./frontend/src/App.jsx */
import React, { useState, useEffect, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { Layout, Typography, Menu, Button, Space, Tag, message } from 'antd';
import { LockOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import axios from 'axios';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';
import './App.css';

const { Header, Content } = Layout;
const { Title } = Typography;

const API_URL = import.meta.env.VITE_API_URL || '';

function AppContent() {
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const location = useLocation();

  const fetchCompanies = useCallback(async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API_URL}/companies/`);
      setCompanies(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      if (error.response && error.response.status === 401) {
        // System is currently locked; auth modal handles unlocking
        setCompanies([]);
      } else {
        console.error(error);
        message.error("Failed to load companies.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCompanies();
    const handleAuthChange = () => {
      fetchCompanies();
    };
    window.addEventListener('adm-auth-changed', handleAuthChange);
    return () => window.removeEventListener('adm-auth-changed', handleAuthChange);
  }, [fetchCompanies]);

  const handleLock = async () => {
    if (typeof window.lockSystem === 'function') {
      await window.lockSystem();
    } else {
      await axios.post(`${API_URL}/api/ledger`, { action: 'lock' });
      window.dispatchEvent(new CustomEvent('adm-auth-changed', { detail: { locked: true } }));
    }
  };

  const activeMenu = location.pathname === '/settings' ? 'settings' : 'dashboard';

  return (
    <Layout className="app-layout">
      <Header className="app-header">
        <Title level={4} className="app-title">Money Total Sheet</Title>
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
        <Space size="middle">
          <Tag icon={<SafetyCertificateOutlined />} color="success" style={{ margin: 0, fontWeight: 600 }}>
            AES-256-GCM Encrypted
          </Tag>
          <Button
            size="small"
            danger
            type="primary"
            icon={<LockOutlined />}
            onClick={handleLock}
            title="Lock Encrypted Database"
          >
            Lock
          </Button>
        </Space>
      </Header>
      
      <Content className="app-content">
        <div className="app-inner-box">
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
