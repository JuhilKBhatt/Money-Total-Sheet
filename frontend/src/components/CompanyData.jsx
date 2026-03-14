/* ./frontend/src/components/CompanyData.jsx */
import React, { useState, useEffect } from 'react';
import { Button, Modal, message, Typography, Spin, Table, Form, DatePicker, InputNumber, Space, Input, Select, Popconfirm } from 'antd';
import { PlusOutlined, MinusCircleOutlined, FallOutlined } from '@ant-design/icons';
import axios from 'axios';
import dayjs from 'dayjs';

const { Text, Title } = Typography;
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export default function CompanyData({ companyId }) {
  const [pickups, setPickups] = useState([]);
  const [deductions, setDeductions] = useState([]);
  const [yards, setYards] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modals & Editing State
  const [isPickupModalVisible, setIsPickupModalVisible] = useState(false);
  const [isDeductionModalVisible, setIsDeductionModalVisible] = useState(false);
  const [editingId, setEditingId] = useState(null); // Tracks if we are editing an existing item

  const [pickupForm] = Form.useForm();
  const [deductionForm] = Form.useForm();

  // Live Calculator for Pickup Modal
  const currentMetals = Form.useWatch('metals', pickupForm) || [];
  const liveTripTotal = currentMetals.reduce((sum, metal) => {
    return sum + ((metal?.net_weight || 0) * (metal?.price_per_unit || 0));
  }, 0);

  useEffect(() => {
    fetchCompanyData();
    fetchYards();
  }, [companyId]);

  const fetchYards = async () => {
    try {
      const response = await axios.get(`${API_URL}/yards/`);
      setYards(response.data);
    } catch (error) {
      console.error("Failed to load yards", error);
    }
  };

  const fetchCompanyData = async () => {
    try {
      setLoading(true);
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

  // ==========================================
  // MODAL OPENERS
  // ==========================================
  const openAddPickup = () => {
    setEditingId(null);
    pickupForm.resetFields();
    setIsPickupModalVisible(true);
  };

  const openEditPickup = (pickup) => {
    setEditingId(pickup.id);
    pickupForm.setFieldsValue({
      date: dayjs(pickup.date),
      yard: pickup.yard,
      notes: pickup.notes,
      metals: pickup.metals // Automatically populates the dynamic metal fields
    });
    setIsPickupModalVisible(true);
  };

  const openAddDeduction = () => {
    setEditingId(null);
    deductionForm.resetFields();
    setIsDeductionModalVisible(true);
  };

  const openEditDeduction = (deduction) => {
    setEditingId(deduction.id);
    deductionForm.setFieldsValue({
      date: dayjs(deduction.date),
      amount: deduction.amount,
      notes: deduction.notes
    });
    setIsDeductionModalVisible(true);
  };

  // ==========================================
  // SUBMIT HANDLERS
  // ==========================================
  const handlePickupSubmit = async (values) => {
    try {
      const payload = {
        company_id: companyId,
        date: values.date.format('YYYY-MM-DD'),
        yard: values.yard,
        notes: values.notes || "",
        deduction: 0.0,
        metals: values.metals || []
      };
      
      if (editingId) {
        // To easily replace nested metals, we safely delete the old trip and POST the new one
        await axios.delete(`${API_URL}/pickups/${editingId}`);
        await axios.post(`${API_URL}/pickups/`, payload);
        message.success("Pickup updated successfully!");
      } else {
        await axios.post(`${API_URL}/pickups/`, payload);
        message.success("Pickup added successfully!");
      }
      
      setIsPickupModalVisible(false);
      pickupForm.resetFields();
      setEditingId(null);
      fetchCompanyData();
    } catch (error) {
      message.error("Failed to save pickup.");
    }
  };

  const handleDeductionSubmit = async (values) => {
    try {
      const payload = {
        company_id: companyId,
        date: values.date.format('YYYY-MM-DD'),
        amount: values.amount,
        notes: values.notes || ""
      };

      if (editingId) {
        await axios.put(`${API_URL}/deductions/${editingId}`, payload);
        message.success("Deduction updated!");
      } else {
        await axios.post(`${API_URL}/deductions/`, payload);
        message.success("Deduction applied!");
      }

      setIsDeductionModalVisible(false);
      deductionForm.resetFields();
      setEditingId(null);
      fetchCompanyData();
    } catch (error) {
      message.error("Failed to save deduction.");
    }
  };

  const handleDeletePickup = async (id) => {
    try {
      await axios.delete(`${API_URL}/pickups/${id}`);
      message.success("Trip deleted.");
      fetchCompanyData();
    } catch (error) {
      message.error("Failed to delete trip.");
    }
  };

  const handleDeleteDeduction = async (id) => {
    try {
      await axios.delete(`${API_URL}/deductions/${id}`);
      message.success("Deduction deleted.");
      fetchCompanyData();
    } catch (error) {
      message.error("Failed to delete deduction.");
    }
  };

  // ==========================================
  // ALGORITHM: EXCEL LEDGER REPLICATION
  // ==========================================
  const buildLedgerData = () => {
    let events = [];
    pickups.forEach(p => events.push({ ...p, eventType: 'pickup' }));
    deductions.forEach(d => events.push({ ...d, eventType: 'deduction' }));

    events.sort((a, b) => {
      const dateA = new Date(a.date);
      const dateB = new Date(b.date);
      if (dateA < dateB) return -1;
      if (dateA > dateB) return 1;
      if (a.eventType === 'pickup' && b.eventType === 'deduction') return -1;
      if (a.eventType === 'deduction' && b.eventType === 'pickup') return 1;
      return 0;
    });

    const data = [];
    let runningBalance = 0;

    events.forEach((event, index) => {
      const nextEvent = events[index + 1];

      if (event.eventType === 'pickup') {
        if (event.metals && event.metals.length > 0) {
          event.metals.forEach((metal, mIndex) => {
            const metalTotal = metal.net_weight * metal.price_per_unit;
            runningBalance += metalTotal;
            
            data.push({
              key: `metal-${metal.id}`,
              type: 'metal',
              rawPickup: event,
              date: mIndex === 0 ? dayjs(event.date).format('DD/MM/YY') : '',
              yardNotes: mIndex === 0 ? [event.yard, event.notes].filter(Boolean).join(' - ') : '',
              metal: metal.metal_name,
              kg: metal.net_weight,
              price: metal.price_per_unit,
              total: metalTotal,
              isFirstMetal: mIndex === 0
            });
          });
        }

        const isTypeChange = !nextEvent || nextEvent.eventType === 'deduction';
        const isDateChange = nextEvent && nextEvent.eventType === 'pickup' && nextEvent.date !== event.date;

        if (isTypeChange || isDateChange) {
          data.push({
            key: `bal-p-${event.id}`,
            type: 'balance',
            priceLabel: 'BAL till date >',
            total: runningBalance
          });
        }

      } else if (event.eventType === 'deduction') {
        runningBalance -= event.amount;
        
        data.push({
          key: `deduction-${event.id}`,
          type: 'deduction',
          rawDeduction: event,
          date: dayjs(event.date).format('DD/MM/YY'), 
          yardNotes: event.notes || 'Deduction', 
          metal: '', kg: '', price: '',
          total: event.amount, 
        });

        const isTypeChange = !nextEvent || nextEvent.eventType === 'pickup';
        if (isTypeChange) {
          data.push({
            key: `bal-d-${event.id}`,
            type: 'balance',
            priceLabel: 'BAL till date >',
            total: runningBalance
          });
        }
      }
    });

    return data;
  };

  const tableData = buildLedgerData();

  // ==========================================
  // TABLE COLUMNS
  // ==========================================
  const columns = [
    {
      title: 'Date', 
      dataIndex: 'date', 
      key: 'date',
      width: 90,
      onCell: (record) => ({ colSpan: record.type === 'balance' ? 5 : 1 }),
      render: (val, record) => record.type === 'balance' ? <div style={{ textAlign: 'right', fontWeight: 'bold' }}>{record.priceLabel}</div> : val
    },
    {
      title: 'Yard & Notes', 
      dataIndex: 'yardNotes', 
      key: 'yardNotes',
      width: 200,
      onCell: (record) => {
        if (record.type === 'balance') return { colSpan: 0 };
        if (record.type === 'deduction') return { colSpan: 4 }; // Stretches across Metal, Kg, and $
        return { colSpan: 1 };
      }
    },
    {
      title: 'Metal', 
      dataIndex: 'metal', 
      key: 'metal',
      width: 120,
      onCell: (record) => ({ colSpan: (record.type === 'balance' || record.type === 'deduction') ? 0 : 1 })
    },
    {
      title: 'Kg', 
      dataIndex: 'kg', 
      key: 'kg',
      width: 80,
      onCell: (record) => ({ colSpan: (record.type === 'balance' || record.type === 'deduction') ? 0 : 1 })
    },
    {
      title: '$', 
      dataIndex: 'price', 
      key: 'price',
      width: 80,
      onCell: (record) => ({ colSpan: (record.type === 'balance' || record.type === 'deduction') ? 0 : 1 }),
      render: (val, record) => (val && record.type === 'metal') ? `$${Number(val).toFixed(2)}` : ''
    },
    {
      title: 'Total', 
      dataIndex: 'total', 
      key: 'total',
      width: 100,
      render: (val, record) => {
        if (val === undefined || val === '') return '';
        const num = Number(val);
        if (record.type === 'balance') return <strong style={{ fontSize: '15px' }}>${num.toFixed(2)}</strong>;
        return `$${num.toFixed(2)}`;
      }
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 140,
      className: 'table-actions-col',
      render: (_, record) => {
        if (record.type === 'balance') return null;

        if (record.type === 'deduction') {
          return (
            <Space>
              <Button type="primary" size="small" onClick={() => openEditDeduction(record.rawDeduction)}>Edit</Button>
              <Popconfirm title="Delete this deduction?" onConfirm={() => handleDeleteDeduction(record.rawDeduction.id)}>
                <Button type="primary" danger size="small">Delete</Button>
              </Popconfirm>
            </Space>
          );
        }

        if (record.type === 'metal' && record.isFirstMetal) {
          return (
            <Space>
              <Button type="primary" size="small" onClick={() => openEditPickup(record.rawPickup)}>Edit</Button>
              <Popconfirm title="Delete this entire trip?" onConfirm={() => handleDeletePickup(record.rawPickup.id)}>
                <Button type="primary" danger size="small">Delete</Button>
              </Popconfirm>
            </Space>
          );
        }
        return null;
      }
    }
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={openAddPickup}>
          Add Pickup
        </Button>
        <Button danger icon={<FallOutlined />} onClick={openAddDeduction}>
          Minus Deductions
        </Button>
      </Space>

      {loading ? (
        <Spin style={{ display: 'block', margin: '40px auto' }} />
      ) : (
        <Table 
          dataSource={tableData} 
          columns={columns} 
          pagination={false} 
          bordered
          size="small"
          rowClassName={(record) => {
            if (record.type === 'deduction') return 'row-deduction';
            if (record.type === 'balance') return 'row-balance';
            return '';
          }}
        />
      )}

      {/* ========================================== */}
      {/* PICKUP MODAL (Add & Edit)                  */}
      {/* ========================================== */}

      <Modal
        title={editingId ? "Edit Pickup" : "Add New Pickup"}
        open={isPickupModalVisible}
        onCancel={() => { setIsPickupModalVisible(false); pickupForm.resetFields(); setEditingId(null); }}
        footer={null}
        width={750}
      >
        <Form form={pickupForm} layout="vertical" onFinish={handlePickupSubmit}>
          <Space size="large" style={{ display: 'flex' }}>
            <Form.Item name="date" label="Date" rules={[{ required: true }]}>
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="yard" label="Yard" rules={[{ required: true }]}>
              <Select placeholder="Select a Yard" style={{ width: 200 }}>
                {yards.map(yard => (
                  <Select.Option key={yard.id} value={yard.name}>{yard.name}</Select.Option>
                ))}
              </Select>
            </Form.Item>
          </Space>
          <Form.Item name="notes" label="Notes">
            <Input.TextArea rows={2} placeholder="Optional notes about this trip..." />
          </Form.Item>

          <Text strong>Metal Items:</Text>
          <div style={{ background: '#f9f9f9', padding: '15px', borderRadius: '8px', marginTop: '10px' }}>
            <Form.List name="metals">
              {(fields, { add, remove }) => (
                <>
                  {fields.map(({ key, name, ...restField }) => (
                    <Space key={key} style={{ display: 'flex', marginBottom: 8 }} align="baseline">
                      <Form.Item {...restField} name={[name, 'metal_name']} rules={[{ required: true, message: 'Required' }]}>
                        <Input placeholder="Metal Type (e.g. Copper)" />
                      </Form.Item>
                      <Form.Item {...restField} name={[name, 'net_weight']} rules={[{ required: true, message: 'Required' }]}>
                        <InputNumber placeholder="Weight (kg)" min={0} step={1} />
                      </Form.Item>
                      <Form.Item {...restField} name={[name, 'price_per_unit']} rules={[{ required: true, message: 'Required' }]}>
                        <InputNumber placeholder="Price / kg" min={0} step={0.01} />
                      </Form.Item>
                      <MinusCircleOutlined onClick={() => remove(name)} style={{ color: 'red' }} />
                    </Space>
                  ))}
                  <Form.Item style={{ margin: 0 }}>
                    <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>
                      Add Metal Item
                    </Button>
                  </Form.Item>
                </>
              )}
            </Form.List>

            <div style={{ textAlign: 'right', marginTop: 15 }}>
              <Title level={5} style={{ margin: 0 }}>Live Total: ${liveTripTotal.toFixed(2)}</Title>
            </div>
          </div>

          <Form.Item style={{ marginTop: 24, textAlign: 'right' }}>
            <Button onClick={() => { setIsPickupModalVisible(false); setEditingId(null); }} style={{ marginRight: 8 }}>Cancel</Button>
            <Button type="primary" htmlType="submit">{editingId ? "Save Changes" : "Submit Pickup"}</Button>
          </Form.Item>
        </Form>
      </Modal>

      {/* ========================================== */}
      {/* DEDUCTION MODAL (Add & Edit)               */}
      {/* ========================================== */}

      <Modal
        title={editingId ? "Edit Deduction" : "Minus Deductions"}
        open={isDeductionModalVisible}
        onCancel={() => { setIsDeductionModalVisible(false); deductionForm.resetFields(); setEditingId(null); }}
        footer={null}
      >
        <Form form={deductionForm} layout="vertical" onFinish={handleDeductionSubmit}>
          <Form.Item name="date" label="Date" rules={[{ required: true }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="amount" label="Amount to Deduct ($)" rules={[{ required: true }]}>
            <InputNumber min={0.01} step={0.01} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="notes" label="Reason / Notes">
            <Input.TextArea rows={3} placeholder="e.g. Advance payment, Collected by..." />
          </Form.Item>
          <Form.Item style={{ textAlign: 'right' }}>
            <Button onClick={() => { setIsDeductionModalVisible(false); setEditingId(null); }} style={{ marginRight: 8 }}>Cancel</Button>
            <Button danger type="primary" htmlType="submit">{editingId ? "Save Changes" : "Deduct Funds"}</Button>
          </Form.Item>
        </Form>
      </Modal>

    </div>
  );
}