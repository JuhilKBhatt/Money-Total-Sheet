/* ./frontend/src/components/CompanyData.jsx */
import React, { useState, useEffect } from 'react';
import { Button, Modal, message, Typography, Spin, Table, Form, DatePicker, InputNumber, Space, Input, Select } from 'antd';
import { PlusOutlined, MinusCircleOutlined, FallOutlined } from '@ant-design/icons';
import axios from 'axios';

const { Text } = Typography;
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export default function CompanyData({ companyId }) {
  const [pickups, setPickups] = useState([]);
  const [deductions, setDeductions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [yards, setYards] = useState([]);

  const [isPickupModalVisible, setIsPickupModalVisible] = useState(false);
  const [isDeductionModalVisible, setIsDeductionModalVisible] = useState(false);
  
  const [pickupForm] = Form.useForm();
  const [deductionForm] = Form.useForm();

    useEffect(() => {
    fetchCompanyData();
  }, [companyId]);

    useEffect(() => {
    fetchCompanyData();
    fetchYards(); // New function call
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
      fetchCompanyData();
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
      fetchCompanyData();
    } catch (error) {
      console.error(error);
      message.error("Failed to apply deduction.");
    }
  };

  const tableData = [];
  
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
    if (pickup.deduction > 0) {
      tableData.push({
        key: `pickup-deduct-${pickup.id}`,
        date: pickup.date,
        yard: pickup.yard,
        notes: 'Trip Deduction (Fees/Tolls)',
        metal: '-',
        netWeight: '-',
        price: '-',
        total: -pickup.deduction
      });
    }
  });

  deductions.forEach((deduction) => {
    tableData.push({
      key: `deduction-${deduction.id}`,
      date: deduction.date,
      yard: '-',
      notes: deduction.notes || 'Standalone Deduction',
      metal: 'DEDUCTION',
      netWeight: '-',
      price: '-',
      total: -deduction.amount
    });
  });

  tableData.sort((a, b) => new Date(b.date) - new Date(a.date));
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

      {/* Add Pickup Modal */}
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
            <Form.Item name="yard" label="Yard" rules={[{ required: true, message: 'Please select a yard' }]}>
              <Select placeholder="Select a Yard">
                {yards.map(yard => (
                  <Select.Option key={yard.id} value={yard.name}>
                    {yard.name}
                  </Select.Option>
                ))}
              </Select>
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

      {/* Minus Deductions Modal */}
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