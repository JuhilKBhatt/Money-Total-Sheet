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