// ./frontend/src/components/settings/YardSettings.jsx
import React, { useState, useEffect } from 'react';
import { Input, Button, Modal, message, List, Popconfirm, Form } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export default function YardSettings() {
  const [yards, setYards] = useState([]);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [form] = Form.useForm();

  useEffect(() => { fetchYards(); }, []);

  const fetchYards = async () => {
    try {
      const res = await axios.get(`${API_URL}/yards/`);
      setYards(res.data);
    } catch (error) {
      console.error("Error fetching yards:", error);
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
        await axios.put(`${API_URL}/yards/${editingItem.id}`, values);
        message.success("Yard updated!");
      } else {
        await axios.post(`${API_URL}/yards/`, values);
        message.success("Yard added!");
      }
      setIsModalVisible(false); 
      fetchYards();
    } catch (error) {
      message.error("Failed to save Yard.");
    }
  };

  const handleDelete = async (id) => {
    try {
      await axios.delete(`${API_URL}/yards/${id}`); 
      message.success("Yard deleted!");
      fetchYards();
    } catch (error) {
      message.error("Failed to delete Yard.");
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => showModal()}>Add Yard</Button>
      </div>

      <List dataSource={yards} renderItem={(item) => (
        <List.Item actions={[
            <Button type="link" icon={<EditOutlined />} onClick={() => showModal(item)}>Edit</Button>,
            <Popconfirm title="Delete?" onConfirm={() => handleDelete(item.id)}><Button type="link" danger icon={<DeleteOutlined />}>Delete</Button></Popconfirm>
        ]}>
          <List.Item.Meta title={item.name} />
        </List.Item>
      )} />

      <Modal title={editingItem ? "Edit Yard" : "Add Yard"} open={isModalVisible} onCancel={() => setIsModalVisible(false)} onOk={() => form.submit()}>
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="name" label="Yard Name" rules={[{ required: true }]}><Input maxLength={100} /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}