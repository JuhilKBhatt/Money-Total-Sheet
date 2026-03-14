/* ./frontend/src/components/LedgerTable.jsx */
import React from 'react';
import { Table, Typography, Space, Button, Popconfirm } from 'antd';

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
      width: 100,
      align: 'center', // Centers vertically and horizontally within merged cell
      onCell: (record) => {
        if (record.type === 'balance') return { colSpan: 5 };
        return { rowSpan: record.rowSpan !== undefined ? record.rowSpan : 1 };
      },
      render: (val, record) => record.type === 'balance' ? <div style={{ textAlign: 'right', fontWeight: 'bold' }}>{record.priceLabel}</div> : val
    },
    {
      title: 'Yard & Notes', 
      dataIndex: 'yardNotes', 
      key: 'yardNotes',
      width: 250,
      align: 'center', // Centers vertically and horizontally within merged cell
      onCell: (record) => {
        if (record.type === 'balance') return { colSpan: 0 };
        if (record.type === 'deduction') return { colSpan: 4 }; // Stretches across Metal, Kg, and $
        return { rowSpan: record.rowSpan !== undefined ? record.rowSpan : 1 };
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
      width: 120,
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
      align: 'center', // Centers vertically and horizontally within merged cell
      className: 'table-actions-col',
      onCell: (record) => {
        if (record.type === 'balance') return { colSpan: 0 };
        return { rowSpan: record.rowSpan !== undefined ? record.rowSpan : 1 };
      },
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

        // Only render the buttons on the first row of the merge group
        if (record.type === 'metal' && record.rowSpan > 0) { 
          return (
            <Space direction="vertical" size="small">
              <Button type="primary" size="small" block onClick={() => openEditPickup(record.rawPickup)}>Edit Trip</Button>
              <Popconfirm title="Delete this entire trip?" onConfirm={() => handleDeletePickup(record.rawPickup.id)}>
                <Button type="primary" danger size="small" block>Delete Trip</Button>
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