/* ./frontend/src/components/PickupModal.jsx */
import React from 'react';
import { Modal, Form, Space, DatePicker, Select, Input, Typography, InputNumber, Button, AutoComplete } from 'antd';
import { PlusOutlined, MinusCircleOutlined } from '@ant-design/icons';

const { Text, Title } = Typography;

export default function PickupModal({ visible, onCancel, onSubmit, form, yards, currencies, units, editingId, defaultUnit, metalOptions }) {
  const currentMetals = Form.useWatch('metals', form) || [];
  const currentCurrency = Form.useWatch('currency', form) || '$'; 
  
  const liveTripTotal = currentMetals.reduce((sum, metal) => sum + ((metal?.net_weight || 0) * (metal?.price_per_unit || 0)), 0);

  return (
    <Modal title={editingId ? "Edit Pickup" : "Add New Pickup"} open={visible} onCancel={onCancel} footer={null} width={800}>
      <Form form={form} layout="vertical" onFinish={onSubmit}>
        <Space size="large" style={{ display: 'flex' }}>
          <Form.Item name="date" label="Date" rules={[{ required: true, message: 'Please select a date' }]}>
            <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="yard" label="Yard" rules={[{ required: true, message: 'Please select a yard' }]}>
            <Select placeholder="Select a Yard" style={{ width: 180 }}>
              {yards.map(yard => <Select.Option key={yard.id} value={yard.name}>{yard.name}</Select.Option>)}
            </Select>
          </Form.Item>
          <Form.Item name="currency" label="Currency" rules={[{ required: true, message: 'Please select a currency' }]}>
            <Select style={{ width: 100 }}>
              {currencies.map(c => <Select.Option key={c.id} value={c.label}>{c.label}</Select.Option>)}
            </Select>
          </Form.Item>
        </Space>
        
        <Form.Item name="notes" label="Notes">
          <Input.TextArea rows={2} maxLength={1000} showCount placeholder="Optional notes about this trip..." />
        </Form.Item>

        <Text strong>Metal Items:</Text>
        <div style={{ background: '#f9f9f9', padding: '15px', borderRadius: '8px', marginTop: '10px' }}>
          <Form.List name="metals">
            {(fields, { add, remove }) => (
              <>
                {fields.map(({ key, name, ...restField }) => (
                  <Space key={key} style={{ display: 'flex', marginBottom: 8 }} align="baseline">
                    <Form.Item {...restField} name={[name, 'metal_name']} rules={[{ required: true, message: 'Please enter the metal type' }]}>
                      <AutoComplete
                        options={metalOptions}
                        placeholder="Metal Type (e.g. Copper)"
                        maxLength={100}
                        filterOption={(inputValue, option) =>
                          option.value.toUpperCase().indexOf(inputValue.toUpperCase()) !== -1
                        }
                        style={{ width: 180 }}
                      />
                    </Form.Item>

                    <Space.Compact>
                      <Form.Item {...restField} name={[name, 'net_weight']} noStyle>
                        <InputNumber 
                          placeholder="Weight" 
                          min={0} 
                          max={999999999}
                          step={0.001} 
                          precision={3}
                          style={{ width: '100%' }}
                          formatter={(value) => {
                            if (!value) return '';
                            const parts = value.toString().split('.');
                            parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
                            return parts.join('.');
                          }}
                          parser={(value) => value.replace(/\$\s?|(,*)/g, '')}
                        />
                      </Form.Item>
                      <Form.Item {...restField} name={[name, 'weight_unit']} initialValue={defaultUnit} noStyle>
                        <Select style={{ width: 80 }}>
                          {units.map(u => <Select.Option key={u.id} value={u.value}>{u.value}</Select.Option>)}
                        </Select>
                      </Form.Item>
                    </Space.Compact>

                    <Form.Item {...restField} name={[name, 'price_per_unit']}>
                      <InputNumber 
                        addonBefore={currentCurrency} 
                        placeholder="Price per unit" 
                        min={0} 
                        max={999999999}
                        step={0.01} 
                        precision={2}
                        style={{ width: '100%' }}
                        formatter={(value) => {
                          if (!value) return '';
                          const parts = value.toString().split('.');
                          parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
                          return parts.join('.');
                        }}
                        parser={(value) => value.replace(/\$\s?|(,*)/g, '')}
                      />
                    </Form.Item>
                    <MinusCircleOutlined onClick={() => remove(name)} style={{ color: 'red' }} />
                  </Space>
                ))}
                <Form.Item style={{ margin: 0 }}>
                  <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>Add Metal Item</Button>
                </Form.Item>
              </>
            )}
          </Form.List>
          <div style={{ textAlign: 'right', marginTop: 15 }}>
            <Title level={5} style={{ margin: 0 }}>
              Live Total: {currentCurrency}{liveTripTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </Title>
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