/* ./frontend/src/pages/Settings.jsx */
import React, { useState, useEffect } from 'react';
import { Input, Button, Modal, message, Card, List, Popconfirm, Divider, Form, Space } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export default function Settings({ companies, fetchCompanies }) {
  // Existing state
  const [isAddModalVisible, setIsAddModalVisible] = useState(false);
  const [isEditModalVisible, setIsEditModalVisible] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState('');
  const [editingCompany, setEditingCompany] = useState(null);
  const [editCompanyName, setEditCompanyName] = useState('');

  const [yards, setYards] = useState([]);
  const [isAddYardModalVisible, setIsAddYardModalVisible] = useState(false);
  const [newYardName, setNewYardName] = useState('');

  // New State for Currencies & Units
  const [currencies, setCurrencies] = useState([]);
  const [units, setUnits] = useState([]);
  const [isAddCurrencyVisible, setIsAddCurrencyVisible] = useState(false);
  const [isAddUnitVisible, setIsAddUnitVisible] = useState(false);
  const [currencyForm] = Form.useForm();
  const [unitForm] = Form.useForm();

  useEffect(() => {
    fetchOptions();
  }, []);

  const fetchOptions = async () => {
    try {
      const [yardsRes, currRes, unitsRes] = await Promise.all([
        axios.get(`${API_URL}/yards/`),
        axios.get(`${API_URL}/currencies/`),
        axios.get(`${API_URL}/units/`)
      ]);
      setYards(yardsRes.data);
      setCurrencies(currRes.data);
      setUnits(unitsRes.data);
    } catch (error) {
      console.error(error);
    }
  };

  // Companies / Yards Functions ...
  const handleAddCompany = async () => {
    if (!newCompanyName.trim()) return message.warning("Name cannot be empty.");
    await axios.post(`${API_URL}/companies/`, { name: newCompanyName.trim() });
    setNewCompanyName(''); setIsAddModalVisible(false); fetchCompanies();
  };
  const handleUpdateCompany = async () => {
    await axios.put(`${API_URL}/companies/${editingCompany.id}`, { name: editCompanyName.trim() });
    setIsEditModalVisible(false); fetchCompanies();
  };
  const handleDeleteCompany = async (id) => {
    await axios.delete(`${API_URL}/companies/${id}`); fetchCompanies();
  };
  const handleAddYard = async () => {
    await axios.post(`${API_URL}/yards/`, { name: newYardName.trim() });
    setNewYardName(''); setIsAddYardModalVisible(false); fetchOptions();
  };
  const handleDeleteYard = async (id) => {
    await axios.delete(`${API_URL}/yards/${id}`); fetchOptions();
  };

  // Currency & Unit Functions
  const handleAddCurrency = async (values) => {
    await axios.post(`${API_URL}/currencies/`, values);
    setIsAddCurrencyVisible(false); currencyForm.resetFields(); fetchOptions();
  };
  const handleDeleteCurrency = async (id) => {
    await axios.delete(`${API_URL}/currencies/${id}`); fetchOptions();
  };
  const handleAddUnit = async (values) => {
    await axios.post(`${API_URL}/units/`, values);
    setIsAddUnitVisible(false); unitForm.resetFields(); fetchOptions();
  };
  const handleDeleteUnit = async (id) => {
    await axios.delete(`${API_URL}/units/${id}`); fetchOptions();
  };

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      {/* Companies */}
      <Card title="Manage Companies" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setIsAddModalVisible(true)}>Add Company</Button>}>
        <List itemLayout="horizontal" dataSource={companies} renderItem={(company) => (
            <List.Item actions={[
                <Button type="text" icon={<EditOutlined />} onClick={() => {setEditingCompany(company); setEditCompanyName(company.name); setIsEditModalVisible(true);}}>Edit</Button>,
                <Popconfirm title="Delete company?" onConfirm={() => handleDeleteCompany(company.id)}><Button type="text" danger icon={<DeleteOutlined />}>Delete</Button></Popconfirm>
              ]}>
              <List.Item.Meta title={company.name} />
            </List.Item>
          )} />
      </Card>
      <Divider />

      {/* Yards */}
      <Card title="Manage Yards" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setIsAddYardModalVisible(true)}>Add Yard</Button>}>
        <List itemLayout="horizontal" dataSource={yards} renderItem={(yard) => (
            <List.Item actions={[
                <Popconfirm title="Delete yard?" onConfirm={() => handleDeleteYard(yard.id)}><Button type="text" danger icon={<DeleteOutlined />}>Delete</Button></Popconfirm>
              ]}>
              <List.Item.Meta title={yard.name} />
            </List.Item>
          )} />
      </Card>
      <Divider />

      <Space direction="vertical" style={{ width: '100%' }} size="large">
        {/* Currencies */}
        <Card title="Custom Currencies" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setIsAddCurrencyVisible(true)}>Add Currency</Button>}>
          <List itemLayout="horizontal" dataSource={currencies} renderItem={(c) => (
              <List.Item actions={[<Popconfirm title="Delete?" onConfirm={() => handleDeleteCurrency(c.id)}><Button type="text" danger icon={<DeleteOutlined />}>Delete</Button></Popconfirm>]}>
                <List.Item.Meta title={`${c.label} (${c.symbol})`} description={`Code: ${c.code}`} />
              </List.Item>
            )} />
        </Card>

        {/* Units */}
        <Card title="Custom Weight Units" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setIsAddUnitVisible(true)}>Add Unit</Button>}>
          <List itemLayout="horizontal" dataSource={units} renderItem={(u) => (
              <List.Item actions={[<Popconfirm title="Delete?" onConfirm={() => handleDeleteUnit(u.id)}><Button type="text" danger icon={<DeleteOutlined />}>Delete</Button></Popconfirm>]}>
                <List.Item.Meta title={u.label} description={`Value: ${u.value}`} />
              </List.Item>
            )} />
        </Card>
      </Space>

      {/* Modals */}
      <Modal title="Add New Company" open={isAddModalVisible} onOk={handleAddCompany} onCancel={() => setIsAddModalVisible(false)}><Input value={newCompanyName} onChange={(e) => setNewCompanyName(e.target.value)}/></Modal>
      <Modal title="Edit Company" open={isEditModalVisible} onOk={handleUpdateCompany} onCancel={() => setIsEditModalVisible(false)}><Input value={editCompanyName} onChange={(e) => setEditCompanyName(e.target.value)}/></Modal>
      <Modal title="Add New Yard" open={isAddYardModalVisible} onOk={handleAddYard} onCancel={() => setIsAddYardModalVisible(false)}><Input value={newYardName} onChange={(e) => setNewYardName(e.target.value)}/></Modal>
      
      <Modal title="Add Currency" open={isAddCurrencyVisible} onCancel={() => setIsAddCurrencyVisible(false)} onOk={() => currencyForm.submit()}>
        <Form form={currencyForm} layout="vertical" onFinish={handleAddCurrency}>
          <Form.Item name="code" label="Code (e.g. AUD)" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="symbol" label="Symbol (e.g. $)" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="label" label="Label (e.g. AUD$)" rules={[{ required: true }]}><Input /></Form.Item>
        </Form>
      </Modal>

      <Modal title="Add Weight Unit" open={isAddUnitVisible} onCancel={() => setIsAddUnitVisible(false)} onOk={() => unitForm.submit()}>
        <Form form={unitForm} layout="vertical" onFinish={handleAddUnit}>
          <Form.Item name="value" label="Value (e.g. kg)" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="label" label="Label (e.g. Kilograms)" rules={[{ required: true }]}><Input /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}