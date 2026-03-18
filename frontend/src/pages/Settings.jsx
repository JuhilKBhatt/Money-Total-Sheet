/* ./frontend/src/pages/Settings.jsx */
import React, { useState, useEffect } from 'react';
import { Input, Button, Modal, message, List, Popconfirm, Form, Collapse, Typography } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, SettingOutlined } from '@ant-design/icons';
import axios from 'axios';

const { Panel } = Collapse;
const { Text } = Typography;
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export default function Settings({ companies, fetchCompanies }) {
  // --- State Management ---
  const [yards, setYards] = useState([]);
  const [currencies, setCurrencies] = useState([]);
  const [units, setUnits] = useState([]);

  // Modals Visibility
  const [isAddModalVisible, setIsAddModalVisible] = useState(false);
  const [isEditModalVisible, setIsEditModalVisible] = useState(false);
  const [isYardModalVisible, setIsYardModalVisible] = useState(false);
  const [isCurrencyModalVisible, setIsCurrencyModalVisible] = useState(false);
  const [isUnitModalVisible, setIsUnitModalVisible] = useState(false);

  // Editing State
  const [editingItem, setEditingItem] = useState(null); // Stores the object being edited
  const [newCompanyName, setNewCompanyName] = useState('');
  const [editCompanyName, setEditCompanyName] = useState('');

  const [yardForm] = Form.useForm();
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
      console.error("Error fetching settings options:", error);
    }
  };

  // --- Handlers: Companies ---
  const handleAddCompany = async () => {
    if (!newCompanyName.trim()) return message.warning("Name cannot be empty.");
    await axios.post(`${API_URL}/companies/`, { name: newCompanyName.trim() });
    setNewCompanyName(''); setIsAddModalVisible(false); fetchCompanies();
  };
  const handleUpdateCompany = async () => {
    await axios.put(`${API_URL}/companies/${editingItem.id}`, { name: editCompanyName.trim() });
    setIsEditModalVisible(false); fetchCompanies();
  };
  const handleDeleteCompany = async (id) => {
    await axios.delete(`${API_URL}/companies/${id}`); fetchCompanies();
  };

  // --- Handlers: Yards ---
  const showYardModal = (item = null) => {
    setEditingItem(item);
    if (item) yardForm.setFieldsValue(item);
    else yardForm.resetFields();
    setIsYardModalVisible(true);
  };
  const handleYardSubmit = async (values) => {
    if (editingItem) {
      await axios.put(`${API_URL}/yards/${editingItem.id}`, values);
    } else {
      await axios.post(`${API_URL}/yards/`, values);
    }
    setIsYardModalVisible(false); fetchOptions();
  };
  const handleDeleteYard = async (id) => {
    await axios.delete(`${API_URL}/yards/${id}`); fetchOptions();
  };

  // --- Handlers: Currencies ---
  const showCurrencyModal = (item = null) => {
    setEditingItem(item);
    if (item) currencyForm.setFieldsValue(item);
    else currencyForm.resetFields();
    setIsCurrencyModalVisible(true);
  };
  const handleCurrencySubmit = async (values) => {
    try {
      if (editingItem) {
        await axios.put(`${API_URL}/currencies/${editingItem.id}`, values);
        message.success("Currency updated successfully!");
      } else {
        await axios.post(`${API_URL}/currencies/`, values);
        message.success("Currency added successfully!");
      }
      setIsCurrencyModalVisible(false); 
      fetchOptions();
    } catch (error) {
      console.error("Currency Error:", error);
      message.error("Failed to save Currency: " + (error.response?.data?.detail || error.message));
    }
  };
  const handleDeleteCurrency = async (id) => {
    try {
      await axios.delete(`${API_URL}/currencies/${id}`); 
      message.success("Currency deleted successfully!");
      fetchOptions(); // Refresh the list
    } catch (error) {
      console.error("Delete Currency Error:", error);
      message.error("Failed to delete currency: " + (error.response?.data?.detail || error.message));
    }
  };

  // --- Handlers: Weight Units ---
  const showUnitModal = (item = null) => {
    setEditingItem(item);
    if (item) unitForm.setFieldsValue(item);
    else unitForm.resetFields();
    setIsUnitModalVisible(true);
  };
  const handleUnitSubmit = async (values) => {
    try {
      if (editingItem) {
        await axios.put(`${API_URL}/units/${editingItem.id}`, values);
        message.success("Unit updated successfully!");
      } else {
        await axios.post(`${API_URL}/units/`, values);
        message.success("Unit added successfully!");
      }
      setIsUnitModalVisible(false); 
      fetchOptions();
    } catch (error) {
      console.error("Unit Error:", error);
      message.error("Failed to save Unit: " + (error.response?.data?.detail || error.message));
    }
  };
  const handleDeleteUnit = async (id) => {
    try {
      await axios.delete(`${API_URL}/units/${id}`); 
      message.success("Unit deleted successfully!");
      fetchOptions(); // Refresh the list
    } catch (error) {
      console.error("Delete Unit Error:", error);
      message.error("Failed to delete unit: " + (error.response?.data?.detail || error.message));
    }
  };

  // --- UI Helper ---
  const sectionHeader = (title, onClick) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', padding: '4px 0' }}>
      <Text strong style={{ fontSize: '18px' }}>{title}</Text>
      <Button type="primary" icon={<PlusOutlined />} onClick={(e) => { e.stopPropagation(); onClick(); }}>Add</Button>
    </div>
  );

  return (
    <div style={{ maxWidth: 800, margin: '24px auto' }}>
      <h2 style={{ marginBottom: 24 }}><SettingOutlined /> System Settings</h2>
      
      <Collapse defaultActiveKey={['1']} expandIconPosition="end" accordion>
        {/* Companies */}
        <Panel header={sectionHeader("Companies", () => setIsAddModalVisible(true))} key="1">
          <List dataSource={companies} renderItem={(item) => (
            <List.Item actions={[
                <Button type="link" icon={<EditOutlined />} onClick={() => {setEditingItem(item); setEditCompanyName(item.name); setIsEditModalVisible(true);}}>Edit</Button>,
                <Popconfirm title="Delete?" onConfirm={() => handleDeleteCompany(item.id)}><Button type="link" danger icon={<DeleteOutlined />}>Delete</Button></Popconfirm>
            ]}>
              <List.Item.Meta title={item.name} />
            </List.Item>
          )} />
        </Panel>

        {/* Yards */}
        <Panel header={sectionHeader("Yards", () => showYardModal())} key="2">
          <List dataSource={yards} renderItem={(item) => (
            <List.Item actions={[
                <Button type="link" icon={<EditOutlined />} onClick={() => showYardModal(item)}>Edit</Button>,
                <Popconfirm title="Delete?" onConfirm={() => handleDeleteYard(item.id)}><Button type="link" danger icon={<DeleteOutlined />}>Delete</Button></Popconfirm>
            ]}>
              <List.Item.Meta title={item.name} />
            </List.Item>
          )} />
        </Panel>

        {/* Currencies */}
        <Panel header={sectionHeader("Currencies", () => showCurrencyModal())} key="3">
          <List dataSource={currencies} renderItem={(item) => (
            <List.Item actions={[
                <Button type="link" icon={<EditOutlined />} onClick={() => showCurrencyModal(item)}>Edit</Button>,
                <Popconfirm title="Delete?" onConfirm={() => handleDeleteCurrency(item.id)}><Button type="link" danger icon={<DeleteOutlined />}>Delete</Button></Popconfirm>
            ]}>
              <List.Item.Meta title={`${item.label} (${item.symbol})`} description={`Code: ${item.code}`} />
            </List.Item>
          )} />
        </Panel>

        {/* Units */}
        <Panel header={sectionHeader("Weight Units", () => showUnitModal())} key="4">
          <List dataSource={units} renderItem={(item) => (
            <List.Item actions={[
                <Button type="link" icon={<EditOutlined />} onClick={() => showUnitModal(item)}>Edit</Button>,
                <Popconfirm title="Delete?" onConfirm={() => handleDeleteUnit(item.id)}><Button type="link" danger icon={<DeleteOutlined />}>Delete</Button></Popconfirm>
            ]}>
              <List.Item.Meta title={item.label} description={`Unit: ${item.value}`} />
            </List.Item>
          )} />
        </Panel>
      </Collapse>

      {/* --- Modals --- */}
      {/* Company Modals */}
      <Modal title="Add Company" open={isAddModalVisible} onOk={handleAddCompany} onCancel={() => setIsAddModalVisible(false)}><Input value={newCompanyName} onChange={(e) => setNewCompanyName(e.target.value)} placeholder="Name" /></Modal>
      <Modal title="Edit Company" open={isEditModalVisible} onOk={handleUpdateCompany} onCancel={() => setIsEditModalVisible(false)}><Input value={editCompanyName} onChange={(e) => setEditCompanyName(e.target.value)} /></Modal>

      {/* Yard Modal */}
      <Modal title={editingItem ? "Edit Yard" : "Add Yard"} open={isYardModalVisible} onCancel={() => setIsYardModalVisible(false)} onOk={() => yardForm.submit()}>
        <Form form={yardForm} layout="vertical" onFinish={handleYardSubmit}>
          <Form.Item name="name" label="Yard Name" rules={[{ required: true }]}><Input /></Form.Item>
        </Form>
      </Modal>

      {/* Currency Modal */}
      <Modal title={editingItem ? "Edit Currency" : "Add Currency"} open={isCurrencyModalVisible} onCancel={() => setIsCurrencyModalVisible(false)} onOk={() => currencyForm.submit()}>
        <Form form={currencyForm} layout="vertical" onFinish={handleCurrencySubmit}>
          <Form.Item name="code" label="Code (e.g. AUD)" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="symbol" label="Symbol (e.g. $)" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="label" label="Label (e.g. AUD$)" rules={[{ required: true }]}><Input /></Form.Item>
        </Form>
      </Modal>

      {/* Unit Modal */}
      <Modal title={editingItem ? "Edit Unit" : "Add Unit"} open={isUnitModalVisible} onCancel={() => setIsUnitModalVisible(false)} onOk={() => unitForm.submit()}>
        <Form form={unitForm} layout="vertical" onFinish={handleUnitSubmit}>
          <Form.Item name="value" label="Value (e.g. kg)" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="label" label="Label (e.g. Kilograms)" rules={[{ required: true }]}><Input /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}