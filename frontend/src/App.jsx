/* ./frontend/src/App.jsx */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { Layout, Typography, Menu, Button, Space, Tooltip, message } from 'antd';
import { LockOutlined } from '@ant-design/icons';
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
  // dbLedState: 'idle' | 'read' | 'write'
  const [dbLedState, setDbLedState] = useState('idle');
  const activeOpsRef = useRef(0);
  const currentModeRef = useRef('idle');
  const clearTimerRef = useRef(null);
  const location = useLocation();

  const startDbActivity = useCallback((mode = 'read') => {
    if (clearTimerRef.current) {
      clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }
    activeOpsRef.current += 1;
    // Prioritize 'write' visual state if both read and write overlap
    if (mode === 'write' || currentModeRef.current !== 'write') {
      currentModeRef.current = mode === 'write' ? 'write' : 'read';
    }
    setDbLedState(currentModeRef.current);
  }, []);

  const endDbActivity = useCallback(() => {
    activeOpsRef.current = Math.max(0, activeOpsRef.current - 1);
    if (activeOpsRef.current === 0) {
      if (clearTimerRef.current) {
        clearTimeout(clearTimerRef.current);
      }
      clearTimerRef.current = setTimeout(() => {
        if (activeOpsRef.current === 0) {
          currentModeRef.current = 'idle';
          setDbLedState('idle');
        }
      }, 350);
    }
  }, []);

  useEffect(() => {
    // Track all Axios HTTP requests to the encrypted SQLite backend
    const reqInterceptor = axios.interceptors.request.use(
      (config) => {
        const method = String(config.method || 'get').toLowerCase();
        const mode = method === 'get' ? 'read' : 'write';
        startDbActivity(mode);
        return config;
      },
      (error) => {
        endDbActivity();
        return Promise.reject(error);
      }
    );

    const resInterceptor = axios.interceptors.response.use(
      (response) => {
        endDbActivity();
        return response;
      },
      (error) => {
        endDbActivity();
        return Promise.reject(error);
      }
    );

    // Track window.fetch database calls dispatched by the SQLite bridge or BackupSettings
    const handleFetchDbActivity = (e) => {
      const detail = e.detail || {};
      if (detail.phase === 'start') {
        startDbActivity(detail.mode || 'write');
      } else if (detail.phase === 'end') {
        endDbActivity();
      }
    };

    window.addEventListener('adm-db-activity', handleFetchDbActivity);

    return () => {
      axios.interceptors.request.eject(reqInterceptor);
      axios.interceptors.response.eject(resInterceptor);
      window.removeEventListener('adm-db-activity', handleFetchDbActivity);
      if (clearTimerRef.current) {
        clearTimeout(clearTimerRef.current);
      }
    };
  }, [startDbActivity, endDbActivity]);

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

  const isBusy = dbLedState !== 'idle';
  const ledLabel =
    dbLedState === 'write'
      ? 'Writing'
      : dbLedState === 'read'
        ? 'Reading'
        : 'Idle';
  const ledTooltip = isBusy
    ? `Database ${ledLabel} in progress — DO NOT unplug USB drive!`
    : 'Database Idle — All changes flushed to encrypted SQLite';

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
          <Tooltip title={ledTooltip} placement="bottomRight">
            <div
              id="db-sync-led"
              className={`db-sync-led-pill ${
                dbLedState === 'write'
                  ? 'db-led-writing'
                  : dbLedState === 'read'
                    ? 'db-led-reading'
                    : 'db-led-idle'
              }`}
              data-busy={isBusy ? 'true' : 'false'}
              data-state={dbLedState}
            >
              <span className="db-sync-led-prefix">DB:</span>
              <span className="db-sync-led-dot-wrap">
                {isBusy && <span className="db-sync-led-ping" />}
                <span className="db-sync-led-dot" />
              </span>
              <span className="db-sync-led-text">{ledLabel}</span>
            </div>
          </Tooltip>
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
