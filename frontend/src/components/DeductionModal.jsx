/* ./frontend/src/components/DeductionModal.jsx */
import React from 'react';
import { Modal, Form, DatePicker, InputNumber, Input, Button, Space, Select } from 'antd';

export default function DeductionModal({ visible, onCancel, onSubmit, form, currencies, editingId }) {
  return (
    <Modal title={editingId ? "Edit Deduction" : "Minus Deductions"} open={visible} onCancel={onCancel} footer={null}>
      <Form form={form} layout="vertical" onFinish={onSubmit}>
        <Space size="large" style={{ display: 'flex' }}>
          <Form.Item name="date" label="Date" rules={[{ required: true }]}><DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} /></Form.Item>
          
          <Form.Item label="Amount to Deduct" required>
             <Space.Compact>
               <Form.Item name="currency" noStyle rules={[{ required: true }]}>
                  <Select style={{ width: 80 }}>
                    {currencies.map(c => <Select.Option key={c.id} value={c.label}>{c.label}</Select.Option>)}
                  </Select>
               </Form.Item>
               <Form.Item name="amount" noStyle rules={[{ required: true }]}>
                 <InputNumber 
                   min={0} 
                   step={0.01} 
                   style={{ width: '100%' }} 
                   formatter={(value) => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                   parser={(value) => value.replace(/\$\s?|(,*)/g, '')}
                 />
               </Form.Item>
             </Space.Compact>
          </Form.Item>
        </Space>
        
        <Form.Item name="notes" label="Reason / Notes"><Input.TextArea rows={3} placeholder="e.g. Advance payment..." /></Form.Item>
        <Form.Item style={{ textAlign: 'right' }}>
          <Button onClick={onCancel} style={{ marginRight: 8 }}>Cancel</Button>
          <Button danger type="primary" htmlType="submit">{editingId ? "Save Changes" : "Deduct Funds"}</Button>
        </Form.Item>
      </Form>
    </Modal>
  );
}