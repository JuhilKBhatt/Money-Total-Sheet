import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { Tabs, Input, Button, Modal, message, Layout, Typography, Card, Space, Spin, Menu, List, Popconfirm } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import axios from 'axios';
import './App.css';

const { Header, Content } = Layout;
const { Title, Text } = Typography;

const API_URL = import.meta.env.VITE_API_URL;

// --- DASHBOARD COMPONENT ---
// Shows standard tabs without the 'x' button or '+' button
function Dashboard({ companies, loading }) {
  if (loading) {
    return <div style={{ textAlign: 'center', padding: '50px' }}><Spin size="large" /></div>;
  }

  if (companies.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '50px' }}>
        <Text type="secondary">No companies found. Please go to Settings to add a company.</Text>
      </div>
    );
  }

  const tabItems = companies.map((company) => ({
    label: company.name,
    key: String(company.id),
    children: (
      <div style={{ padding: '20px 0' }}>
        <Card title={`${company.name} Data`} bordered={false}>
          <Text type="secondary">
            Pickups and Deductions for {company.name} will be displayed here.
          </Text>
        </Card>
      </div>
    ),
  }));

  return <Tabs type="card" items={tabItems} />;
}

// --- SETTINGS COMPONENT ---
// Manage adding, editing, and deleting companies
function Settings({ companies, fetchCompanies }) {
  const [isAddModalVisible, setIsAddModalVisible] = useState(false);
  const [isEditModalVisible, setIsEditModalVisible] = useState(false);
  
  const [newCompanyName, setNewCompanyName] = useState('');
  const [editingCompany, setEditingCompany] = useState(null);
  const [editCompanyName, setEditCompanyName] = useState('');

  // Add Company
  const handleAddCompany = async () => {
    if (!newCompanyName.trim()) {
      message.warning("Company name cannot be empty.");
      return;
    }
    try {
      await axios.post(`${API_URL}/companies/`, { name: newCompanyName.trim() });
      message.success(`Added company: ${newCompanyName}`);
      setNewCompanyName('');
      setIsAddModalVisible(false);
      fetchCompanies();
    } catch (error) {
      console.error(error);
      message.error("Failed to add company. Name might already exist.");
    }
  };

  // Edit Company
  const openEditModal = (company) => {
    setEditingCompany(company);
    setEditCompanyName(company.name);
    setIsEditModalVisible(true);
  };

  const handleUpdateCompany = async () => {
    if (!editCompanyName.trim() || editCompanyName === editingCompany.name) {
      setIsEditModalVisible(false);
      return;
    }
    try {
      await axios.put(`${API_URL}/companies/${editingCompany.id}`, { name: editCompanyName.trim() });
      message.success("Company name updated!");
      setIsEditModalVisible(false);
      fetchCompanies();
    } catch (error) {
      console.error(error);
      message.error("Failed to update company name.");
    }
  };

  // Delete Company
  const handleDeleteCompany = async (id) => {
    try {
      await axios.delete(`${API_URL}/companies/${id}`);
      message.success("Company deleted successfully.");
      fetchCompanies();
    } catch (error) {
      console.error(error);
      message.error("Failed to delete company.");
    }
  };

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <Card 
        title="Manage Companies" 
        extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setIsAddModalVisible(true)}>Add Company</Button>}
      >
        <List
          itemLayout="horizontal"
          dataSource={companies}
          renderItem={(company) => (
            <List.Item
              actions={[
                <Button type="text" icon={<EditOutlined />} onClick={() => openEditModal(company)}>Edit</Button>,
                <Popconfirm
                  title="Delete the company?"
                  description="Are you sure to delete this company and all its data?"
                  onConfirm={() => handleDeleteCompany(company.id)}
                  okText="Yes"
                  cancelText="No"
                >
                  <Button type="text" danger icon={<DeleteOutlined />}>Delete</Button>
                </Popconfirm>
              ]}
            >
              <List.Item.Meta title={company.name} />
            </List.Item>
          )}
        />
      </Card>

      {/* Add Modal */}
      <Modal
        title="Add New Company"
        open={isAddModalVisible}
        onOk={handleAddCompany}
        onCancel={() => { setIsAddModalVisible(false); setNewCompanyName(''); }}
        okText="Add"
      >
        <Input 
          placeholder="Enter company name" 
          value={newCompanyName}
          onChange={(e) => setNewCompanyName(e.target.value)}
          onPressEnter={handleAddCompany}
          autoFocus
        />
      </Modal>

      {/* Edit Modal */}
      <Modal
        title="Edit Company Name"
        open={isEditModalVisible}
        onOk={handleUpdateCompany}
        onCancel={() => setIsEditModalVisible(false)}
        okText="Save"
      >
        <Input 
          value={editCompanyName}
          onChange={(e) => setEditCompanyName(e.target.value)}
          onPressEnter={handleUpdateCompany}
          autoFocus
        />
      </Modal>
    </div>
  );
}

// --- MAIN APP LAYOUT & ROUTING ---
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

  // Determine active menu item based on current URL path
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