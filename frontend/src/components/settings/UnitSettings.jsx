// ./frontend/src/components/settings/UnitSettings.jsx
import React, { useState, useEffect } from 'react';
import { Input, Button, Modal, message, List, Popconfirm, Form } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export default function UnitSettings() {
  const [units, setUnits] = useState([]);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [form] = Form.useForm();

  useEffect(() => { fetchUnits(); }, []);

  const fetchUnits = async () => {
    try {
      const res = await axios.get(`${API_URL}/units/`);
      setUnits(res.data);
    } catch (error) {
      console.error("Error fetching units:", error);
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
        await axios.put(`${API_URL}/units/${editingItem.id}`, values);
        message.success("Unit updated!");
      } else {
        await axios.post(`${API_URL}/units/`, values);
        message.success("Unit added!");
      }
      setIsModalVisible(false); 
      fetchUnits();
    } catch (error) {
      message.error("Failed to save Unit: " + (error.response?.data?.detail || error.message));
    }
  };

  const handleDelete = async (id) => {
    try {
      await axios.delete(`${API_URL}/units/${id}`); 
      message.success("Unit deleted!");
      fetchUnits();
    } catch (error) {
      message.error("Failed to delete Unit: " + (error.response?.data?.detail || error.message));
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => showModal()}>Add Unit</Button>
      </div>

      <List dataSource={units} renderItem={(item) => (
        <List.Item actions={[
            <Button type="link" icon={<EditOutlined />} onClick={() => showModal(item)}>Edit</Button>,
            <Popconfirm title="Delete?" onConfirm={() => handleDelete(item.id)}><Button type="link" danger icon={<DeleteOutlined />}>Delete</Button></Popconfirm>
        ]}>
          <List.Item.Meta title={item.label} description={`Unit: ${item.value}`} />
        </List.Item>
      )} />

      <Modal title={editingItem ? "Edit Unit" : "Add Unit"} open={isModalVisible} onCancel={() => setIsModalVisible(false)} onOk={() => form.submit()}>
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="value" label="Value (e.g. kg)" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="label" label="Label (e.g. Kilograms)" rules={[{ required: true }]}><Input /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}