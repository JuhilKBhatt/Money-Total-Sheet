import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { 
  Tabs, Input, Button, Modal, message, Layout, Typography, Card, 
  Spin, Menu, List, Popconfirm, Table, Form, DatePicker, InputNumber, Space 
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, MinusCircleOutlined, FallOutlined } from '@ant-design/icons';
import axios from 'axios';
import './App.css';

const { Header, Content } = Layout;
const { Title, Text } = Typography;

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

// --- COMPANY DATA TABLE & BUTTONS COMPONENT ---
function CompanyData({ companyId }) {
  const [pickups, setPickups] = useState([]);
  const [deductions, setDeductions] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modals state
  const [isPickupModalVisible, setIsPickupModalVisible] = useState(false);
  const [isDeductionModalVisible, setIsDeductionModalVisible] = useState(false);
  
  // Ant Design Forms
  const [pickupForm] = Form.useForm();
  const [deductionForm] = Form.useForm();

  useEffect(() => {
    fetchCompanyData();
  }, [companyId]);

  const fetchCompanyData = async () => {
    try {
      setLoading(true);
      // Fetch both Pickups and Deductions concurrently
      const [pickupsRes, deductionsRes] = await Promise.all([
        axios.get(`${API_URL}/companies/${companyId}/pickups/`),
        axios.get(`${API_URL}/companies/${companyId}/deductions/`)
      ]);
      setPickups(pickupsRes.data);
      setDeductions(deductionsRes.data);
    } catch (error) {
      console.error(error);
      message.error("Failed to load company data.");
    } finally {
      setLoading(false);
    }
  };

  // --- Submit Handlers ---
  const handleAddPickup = async (values) => {
    try {
      const payload = {
        company_id: companyId,
        date: values.date.format('YYYY-MM-DD'),
        yard: values.yard,
        notes: values.notes || "",
        deduction: values.deduction || 0.0,
        metals: values.metals || []
      };
      
      await axios.post(`${API_URL}/pickups/`, payload);
      message.success("Pickup added successfully!");
      setIsPickupModalVisible(false);
      pickupForm.resetFields();
      fetchCompanyData(); // Refresh table
    } catch (error) {
      console.error(error);
      message.error("Failed to add pickup.");
    }
  };

  const handleAddDeduction = async (values) => {
    try {
      const payload = {
        company_id: companyId,
        date: values.date.format('YYYY-MM-DD'),
        amount: values.amount,
        notes: values.notes || ""
      };

      await axios.post(`${API_URL}/deductions/`, payload);
      message.success("Deduction applied successfully!");
      setIsDeductionModalVisible(false);
      deductionForm.resetFields();
      fetchCompanyData(); // Refresh table
    } catch (error) {
      console.error(error);
      message.error("Failed to apply deduction.");
    }
  };

  // --- Flatten the data for the Table ---
  const tableData = [];
  
  // 1. Map Pickups and their metals
  pickups.forEach((pickup) => {
    if (pickup.metals && pickup.metals.length > 0) {
      pickup.metals.forEach((metal) => {
        tableData.push({
          key: `metal-${metal.id}`,
          date: pickup.date,
          yard: pickup.yard,
          notes: pickup.notes,
          metal: metal.metal_name,
          netWeight: metal.net_weight,
          price: metal.price_per_unit,
          total: metal.total
        });
      });
    }

    // Include pickup-level deductions as a line item if it exists
    if (pickup.deduction > 0) {
      tableData.push({
        key: `pickup-deduct-${pickup.id}`,
        date: pickup.date,
        yard: pickup.yard,
        notes: 'Trip Deduction (Fees/Tolls)',
        metal: '-',
        netWeight: '-',
        price: '-',
        total: -pickup.deduction // Negative because it's a deduction
      });
    }
  });

  // 2. Map Standalone Deductions
  deductions.forEach((deduction) => {
    tableData.push({
      key: `deduction-${deduction.id}`,
      date: deduction.date,
      yard: '-',
      notes: deduction.notes || 'Standalone Deduction',
      metal: 'DEDUCTION',
      netWeight: '-',
      price: '-',
      total: -deduction.amount // Negative to subtract from total
    });
  });

  // Sort by date (newest first)
  tableData.sort((a, b) => new Date(b.date) - new Date(a.date));

  // Calculate Grand Total across all records
  const grandTotal = tableData.reduce((acc, row) => acc + (typeof row.total === 'number' ? row.total : 0), 0);

  const columns = [
    { title: 'Date', dataIndex: 'date', key: 'date' },
    { title: 'Yard', dataIndex: 'yard', key: 'yard' },
    { title: 'Notes', dataIndex: 'notes', key: 'notes' },
    { 
      title: 'Metal', 
      dataIndex: 'metal', 
      key: 'metal',
      render: (text) => text === 'DEDUCTION' ? <Text type="danger">{text}</Text> : text
    },
    { title: 'Net Weight', dataIndex: 'netWeight', key: 'netWeight' },
    { 
      title: 'Price', 
      dataIndex: 'price', 
      key: 'price',
      render: (val) => val !== '-' ? `$${Number(val).toFixed(2)}` : val
    },
    { 
      title: 'Total', 
      dataIndex: 'total', 
      key: 'total',
      render: (val) => {
        if (val === '-') return val;
        const num = Number(val);
        return <Text type={num < 0 ? "danger" : "success"}>${num.toFixed(2)}</Text>;
      }
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setIsPickupModalVisible(true)}>
          Add Pickup
        </Button>
        <Button danger icon={<FallOutlined />} onClick={() => setIsDeductionModalVisible(true)}>
          Minus Deductions
        </Button>
      </Space>

      {loading ? (
        <Spin style={{ display: 'block', margin: '40px auto' }} />
      ) : (
        <Table 
          dataSource={tableData} 
          columns={columns} 
          pagination={{ pageSize: 10 }} 
          bordered
          size="middle"
          summary={() => (
            <Table.Summary.Row style={{ background: '#fafafa' }}>
              <Table.Summary.Cell index={0} colSpan={6}><Text strong>Grand Total</Text></Table.Summary.Cell>
              <Table.Summary.Cell index={1}>
                <Text strong type={grandTotal < 0 ? "danger" : "success"}>
                  ${grandTotal.toFixed(2)}
                </Text>
              </Table.Summary.Cell>
            </Table.Summary.Row>
          )}
        />
      )}

      {/* ADD PICKUP MODAL */}
      <Modal
        title="Add New Pickup"
        open={isPickupModalVisible}
        onCancel={() => { setIsPickupModalVisible(false); pickupForm.resetFields(); }}
        footer={null}
        width={700}
      >
        <Form form={pickupForm} layout="vertical" onFinish={handleAddPickup}>
          <Space size="large" style={{ display: 'flex' }}>
            <Form.Item name="date" label="Date" rules={[{ required: true }]}>
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="yard" label="Yard" rules={[{ required: true }]}>
              <Input placeholder="e.g. Scrappy's Yard" />
            </Form.Item>
            <Form.Item name="deduction" label="Trip Deduction ($)" initialValue={0}>
              <InputNumber min={0} step={0.01} style={{ width: '100%' }} />
            </Form.Item>
          </Space>
          
          <Form.Item name="notes" label="Notes">
            <Input.TextArea rows={2} placeholder="Optional notes about this trip..." />
          </Form.Item>

          <Text strong>Metal Items:</Text>
          <Form.List name="metals">
            {(fields, { add, remove }) => (
              <div style={{ marginTop: 10 }}>
                {fields.map(({ key, name, ...restField }) => (
                  <Space key={key} style={{ display: 'flex', marginBottom: 8 }} align="baseline">
                    <Form.Item {...restField} name={[name, 'metal_name']} rules={[{ required: true, message: 'Required' }]}>
                      <Input placeholder="Metal Type (e.g. Copper)" />
                    </Form.Item>
                    <Form.Item {...restField} name={[name, 'net_weight']} rules={[{ required: true, message: 'Required' }]}>
                      <InputNumber placeholder="Weight" min={0} step={0.1} />
                    </Form.Item>
                    <Form.Item {...restField} name={[name, 'price_per_unit']} rules={[{ required: true, message: 'Required' }]}>
                      <InputNumber placeholder="Price / unit" min={0} step={0.01} />
                    </Form.Item>
                    <MinusCircleOutlined onClick={() => remove(name)} style={{ color: 'red' }} />
                  </Space>
                ))}
                <Form.Item>
                  <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>
                    Add Metal Item
                  </Button>
                </Form.Item>
              </div>
            )}
          </Form.List>

          <Form.Item style={{ marginTop: 24, textAlign: 'right' }}>
            <Button onClick={() => setIsPickupModalVisible(false)} style={{ marginRight: 8 }}>Cancel</Button>
            <Button type="primary" htmlType="submit">Submit Pickup</Button>
          </Form.Item>
        </Form>
      </Modal>

      {/* MINUS DEDUCTIONS MODAL */}
      <Modal
        title="Minus Deductions"
        open={isDeductionModalVisible}
        onCancel={() => { setIsDeductionModalVisible(false); deductionForm.resetFields(); }}
        footer={null}
      >
        <Form form={deductionForm} layout="vertical" onFinish={handleAddDeduction}>
          <Form.Item name="date" label="Date" rules={[{ required: true }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="amount" label="Amount to Deduct ($)" rules={[{ required: true }]}>
            <InputNumber min={0.01} step={0.01} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="notes" label="Reason / Notes">
            <Input.TextArea rows={3} placeholder="e.g. Advance payment, equipment fee..." />
          </Form.Item>
          <Form.Item style={{ textAlign: 'right' }}>
            <Button onClick={() => setIsDeductionModalVisible(false)} style={{ marginRight: 8 }}>Cancel</Button>
            <Button danger type="primary" htmlType="submit">Deduct Funds</Button>
          </Form.Item>
        </Form>
      </Modal>

    </div>
  );
}

// --- DASHBOARD COMPONENT ---
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
      <div style={{ padding: '10px 0' }}>
        <Card title={`${company.name} Ledger`} bordered={false}>
          <CompanyData companyId={company.id} />
        </Card>
      </div>
    ),
  }));

  return <Tabs type="card" items={tabItems} />;
}

// --- SETTINGS COMPONENT ---
function Settings({ companies, fetchCompanies }) {
  const [isAddModalVisible, setIsAddModalVisible] = useState(false);
  const [isEditModalVisible, setIsEditModalVisible] = useState(false);
  
  const [newCompanyName, setNewCompanyName] = useState('');
  const [editingCompany, setEditingCompany] = useState(null);
  const [editCompanyName, setEditCompanyName] = useState('');

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