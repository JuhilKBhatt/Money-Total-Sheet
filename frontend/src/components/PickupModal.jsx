/* ./frontend/src/components/PickupModal.jsx */
import React from 'react';
import { Modal, Form, Space, DatePicker, Select, Input, Typography, InputNumber, Button } from 'antd';
import { PlusOutlined, MinusCircleOutlined } from '@ant-design/icons';

const { Text, Title } = Typography;

export default function PickupModal({ 
  visible, 
  onCancel, 
  onSubmit, 
  form, 
  yards, 
  editingId 
}) {
  // Live Calculator for Pickup Modal
  const currentMetals = Form.useWatch('metals', form) || [];
  const liveTripTotal = currentMetals.reduce((sum, metal) => {
    return sum + ((metal?.net_weight || 0) * (metal?.price_per_unit || 0));
  }, 0);

  return (
    <Modal
      title={editingId ? "Edit Pickup" : "Add New Pickup"}
      open={visible}
      onCancel={onCancel}
      footer={null}
      width={750}
    >
      <Form form={form} layout="vertical" onFinish={onSubmit}>
        <Space size="large" style={{ display: 'flex' }}>
          <Form.Item name="date" label="Date" rules={[{ required: true }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="yard" label="Yard" rules={[{ required: true, message: 'Please select a yard' }]}>
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
          <Button onClick={onCancel} style={{ marginRight: 8 }}>Cancel</Button>
          <Button type="primary" htmlType="submit">{editingId ? "Save Changes" : "Submit Pickup"}</Button>
        </Form.Item>
      </Form>
    </Modal>
  );
}