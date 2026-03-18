// ./frontend/src/components/settings/CompanySettings.jsx
import React, { useState } from 'react';
import { Input, Button, Modal, message, List, Popconfirm } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export default function CompanySettings({ companies, fetchCompanies }) {
  const [isAddModalVisible, setIsAddModalVisible] = useState(false);
  const [isEditModalVisible, setIsEditModalVisible] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [newCompanyName, setNewCompanyName] = useState('');
  const [editCompanyName, setEditCompanyName] = useState('');

  const handleAddCompany = async () => {
    if (!newCompanyName.trim()) return message.warning("Name cannot be empty.");
    try {
      await axios.post(`${API_URL}/companies/`, { name: newCompanyName.trim() });
      message.success("Company added!");
      setNewCompanyName(''); 
      setIsAddModalVisible(false); 
      fetchCompanies();
    } catch (error) {
      message.error("Failed to add company.");
    }
  };

  const handleUpdateCompany = async () => {
    try {
      await axios.put(`${API_URL}/companies/${editingItem.id}`, { name: editCompanyName.trim() });
      message.success("Company updated!");
      setIsEditModalVisible(false); 
      fetchCompanies();
    } catch (error) {
      message.error("Failed to update company.");
    }
  };

  const handleDeleteCompany = async (id) => {
    try {
      await axios.delete(`${API_URL}/companies/${id}`); 
      message.success("Company deleted!");
      fetchCompanies();
    } catch (error) {
      message.error("Failed to delete company.");
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setIsAddModalVisible(true)}>Add Company</Button>
      </div>

      <List dataSource={companies} renderItem={(item) => (
        <List.Item actions={[
            <Button type="link" icon={<EditOutlined />} onClick={() => {setEditingItem(item); setEditCompanyName(item.name); setIsEditModalVisible(true);}}>Edit</Button>,
            <Popconfirm title="Delete?" onConfirm={() => handleDeleteCompany(item.id)}><Button type="link" danger icon={<DeleteOutlined />}>Delete</Button></Popconfirm>
        ]}>
          <List.Item.Meta title={item.name} />
        </List.Item>
      )} />

      <Modal title="Add Company" open={isAddModalVisible} onOk={handleAddCompany} onCancel={() => setIsAddModalVisible(false)}>
        <Input value={newCompanyName} onChange={(e) => setNewCompanyName(e.target.value)} placeholder="Name" />
      </Modal>

      <Modal title="Edit Company" open={isEditModalVisible} onOk={handleUpdateCompany} onCancel={() => setIsEditModalVisible(false)}>
        <Input value={editCompanyName} onChange={(e) => setEditCompanyName(e.target.value)} />
      </Modal>
    </div>
  );
}