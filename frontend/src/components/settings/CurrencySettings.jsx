// ./frontend/src/components/settings/CurrencySettings.jsx
import React, { useState, useEffect } from 'react';
import { Input, Button, Modal, message, List, Popconfirm, Form } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export default function CurrencySettings() {
  const [currencies, setCurrencies] = useState([]);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [form] = Form.useForm();

  useEffect(() => { fetchCurrencies(); }, []);

  const fetchCurrencies = async () => {
    try {
      const res = await axios.get(`${API_URL}/currencies/`);
      setCurrencies(res.data);
    } catch (error) {
      console.error("Error fetching currencies:", error);
    }
  };

  const showModal = (item = null) => {
    setEditingItem(item);
    if (item) form.setFieldsValue(item);
    else form.resetFields();
    setIsModalVisible(true);
  };

  const handleSubmit = async (values) => {
    try {
      if (editingItem) {
        await axios.put(`${API_URL}/currencies/${editingItem.id}`, values);
        message.success("Currency updated!");
      } else {
        await axios.post(`${API_URL}/currencies/`, values);
        message.success("Currency added!");
      }
      setIsModalVisible(false); 
      fetchCurrencies();
    } catch (error) {
      message.error("Failed to save Currency: " + (error.response?.data?.detail || error.message));
    }
  };

  const handleDelete = async (id) => {
    try {
      await axios.delete(`${API_URL}/currencies/${id}`); 
      message.success("Currency deleted!");
      fetchCurrencies();
    } catch (error) {
      message.error("Failed to delete Currency: " + (error.response?.data?.detail || error.message));
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => showModal()}>Add Currency</Button>
      </div>

      <List dataSource={currencies} renderItem={(item) => (
        <List.Item actions={[
            <Button type="link" icon={<EditOutlined />} onClick={() => showModal(item)}>Edit</Button>,
            <Popconfirm title="Delete?" onConfirm={() => handleDelete(item.id)}><Button type="link" danger icon={<DeleteOutlined />}>Delete</Button></Popconfirm>
        ]}>
          <List.Item.Meta title={`${item.label} (${item.symbol})`} description={`Code: ${item.code}`} />
        </List.Item>
      )} />

      <Modal title={editingItem ? "Edit Currency" : "Add Currency"} open={isModalVisible} onCancel={() => setIsModalVisible(false)} onOk={() => form.submit()}>
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="code" label="Code (e.g. AUD)" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="symbol" label="Symbol (e.g. $)" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="label" label="Label (e.g. AUD$)" rules={[{ required: true }]}><Input /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}