/* ./frontend/src/pages/Settings.jsx */
import React, { useState } from 'react';
import { Input, Button, Modal, message, Card, List, Popconfirm } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export default function Settings({ companies, fetchCompanies }) {
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