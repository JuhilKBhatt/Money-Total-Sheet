/* ./frontend/src/components/DeductionModal.jsx */
import React from 'react';
import { Modal, Form, DatePicker, InputNumber, Input, Button } from 'antd';

export default function DeductionModal({ 
  visible, 
  onCancel, 
  onSubmit, 
  form, 
  editingId 
}) {
  return (
    <Modal
      title={editingId ? "Edit Deduction" : "Minus Deductions"}
      open={visible}
      onCancel={onCancel}
      footer={null}
    >
      <Form form={form} layout="vertical" onFinish={onSubmit}>
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
          <Button onClick={onCancel} style={{ marginRight: 8 }}>Cancel</Button>
          <Button danger type="primary" htmlType="submit">{editingId ? "Save Changes" : "Deduct Funds"}</Button>
        </Form.Item>
      </Form>
    </Modal>
  );
}