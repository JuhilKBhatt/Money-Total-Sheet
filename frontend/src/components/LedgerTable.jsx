/* ./frontend/src/components/LedgerTable.jsx */
import React from 'react';
import { Table, Typography, Space, Button, Popconfirm } from 'antd';

const { Text } = Typography;

export default function LedgerTable({ 
  tableData, 
  loading, 
  openEditDeduction, 
  handleDeleteDeduction, 
  openEditPickup, 
  handleDeletePickup 
}) {
  
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
    <Table 
      dataSource={tableData} 
      columns={columns} 
      pagination={false} 
      bordered
      loading={loading}
      size="small"
      rowClassName={(record) => {
        if (record.type === 'deduction') return 'row-deduction';
        if (record.type === 'balance') return 'row-balance';
        return '';
      }}
    />
  );
}