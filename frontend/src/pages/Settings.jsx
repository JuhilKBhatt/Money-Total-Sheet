/* ./frontend/src/pages/Settings.jsx */
import React, { useState, useEffect } from 'react';
import { Input, Button, Modal, message, Card, List, Popconfirm, Divider } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export default function Settings({ companies, fetchCompanies }) {
  // --- Company State ---
  const [isAddModalVisible, setIsAddModalVisible] = useState(false);
  const [isEditModalVisible, setIsEditModalVisible] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState('');
  const [editingCompany, setEditingCompany] = useState(null);
  const [editCompanyName, setEditCompanyName] = useState('');

  // --- Yard State ---
  const [yards, setYards] = useState([]);
  const [isAddYardModalVisible, setIsAddYardModalVisible] = useState(false);
  const [isEditYardModalVisible, setIsEditYardModalVisible] = useState(false);
  const [newYardName, setNewYardName] = useState('');
  const [editingYard, setEditingYard] = useState(null);
  const [editYardName, setEditYardName] = useState('');

  useEffect(() => {
    fetchYards();
  }, []);

  const fetchYards = async () => {
    try {
      const response = await axios.get(`${API_URL}/yards/`);
      setYards(response.data);
    } catch (error) {
      console.error("Failed to load yards", error);
    }
  };

  // ==========================
  // COMPANY HANDLERS
  // ==========================
  const handleAddCompany = async () => {
    if (!newCompanyName.trim()) return message.warning("Name cannot be empty.");
    try {
      await axios.post(`${API_URL}/companies/`, { name: newCompanyName.trim() });
      message.success(`Added company: ${newCompanyName}`);
      setNewCompanyName('');
      setIsAddModalVisible(false);
      fetchCompanies();
    } catch (error) {
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
      message.error("Failed to update company name.");
    }
  };

  const handleDeleteCompany = async (id) => {
    try {
      await axios.delete(`${API_URL}/companies/${id}`);
      message.success("Company deleted successfully.");
      fetchCompanies();
    } catch (error) {
      message.error("Failed to delete company.");
    }
  };

  // ==========================
  // YARD HANDLERS
  // ==========================
  const handleAddYard = async () => {
    if (!newYardName.trim()) return message.warning("Yard name cannot be empty.");
    try {
      await axios.post(`${API_URL}/yards/`, { name: newYardName.trim() });
      message.success(`Added yard: ${newYardName}`);
      setNewYardName('');
      setIsAddYardModalVisible(false);
      fetchYards();
    } catch (error) {
      message.error("Failed to add yard. Name might already exist.");
    }
  };

  const openEditYardModal = (yard) => {
    setEditingYard(yard);
    setEditYardName(yard.name);
    setIsEditYardModalVisible(true);
  };

  const handleUpdateYard = async () => {
    if (!editYardName.trim() || editYardName === editingYard.name) {
      setIsEditYardModalVisible(false);
      return;
    }
    try {
      await axios.put(`${API_URL}/yards/${editingYard.id}`, { name: editYardName.trim() });
      message.success("Yard name updated!");
      setIsEditYardModalVisible(false);
      fetchYards();
    } catch (error) {
      message.error("Failed to update yard name.");
    }
  };

  const handleDeleteYard = async (id) => {
    try {
      await axios.delete(`${API_URL}/yards/${id}`);
      message.success("Yard deleted successfully.");
      fetchYards();
    } catch (error) {
      message.error("Failed to delete yard.");
    }
  };

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      {/* MANAGE COMPANIES */}
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
                <Popconfirm title="Delete company?" onConfirm={() => handleDeleteCompany(company.id)} okText="Yes" cancelText="No">
                  <Button type="text" danger icon={<DeleteOutlined />}>Delete</Button>
                </Popconfirm>
              ]}
            >
              <List.Item.Meta title={company.name} />
            </List.Item>
          )}
        />
      </Card>

      <Divider />

      {/* MANAGE YARDS */}
      <Card 
        title="Manage Yards" 
        extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setIsAddYardModalVisible(true)}>Add Yard</Button>}
      >
        <List
          itemLayout="horizontal"
          dataSource={yards}
          renderItem={(yard) => (
            <List.Item
              actions={[
                <Button type="text" icon={<EditOutlined />} onClick={() => openEditYardModal(yard)}>Edit</Button>,
                <Popconfirm title="Delete yard?" onConfirm={() => handleDeleteYard(yard.id)} okText="Yes" cancelText="No">
                  <Button type="text" danger icon={<DeleteOutlined />}>Delete</Button>
                </Popconfirm>
              ]}
            >
              <List.Item.Meta title={yard.name} />
            </List.Item>
          )}
        />
      </Card>

      {/* --- COMPANY MODALS --- */}
      <Modal title="Add New Company" open={isAddModalVisible} onOk={handleAddCompany} onCancel={() => { setIsAddModalVisible(false); setNewCompanyName(''); }} okText="Add">
        <Input placeholder="Enter company name" value={newCompanyName} onChange={(e) => setNewCompanyName(e.target.value)} onPressEnter={handleAddCompany} autoFocus />
      </Modal>

      <Modal title="Edit Company Name" open={isEditModalVisible} onOk={handleUpdateCompany} onCancel={() => setIsEditModalVisible(false)} okText="Save">
        <Input value={editCompanyName} onChange={(e) => setEditCompanyName(e.target.value)} onPressEnter={handleUpdateCompany} autoFocus />
      </Modal>

      {/* --- YARD MODALS --- */}
      <Modal title="Add New Yard" open={isAddYardModalVisible} onOk={handleAddYard} onCancel={() => { setIsAddYardModalVisible(false); setNewYardName(''); }} okText="Add">
        <Input placeholder="Enter yard name" value={newYardName} onChange={(e) => setNewYardName(e.target.value)} onPressEnter={handleAddYard} autoFocus />
      </Modal>

      <Modal title="Edit Yard Name" open={isEditYardModalVisible} onOk={handleUpdateYard} onCancel={() => setIsEditYardModalVisible(false)} okText="Save">
        <Input value={editYardName} onChange={(e) => setEditYardName(e.target.value)} onPressEnter={handleUpdateYard} autoFocus />
      </Modal>
    </div>
  );
}