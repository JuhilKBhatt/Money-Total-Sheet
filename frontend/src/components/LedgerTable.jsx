/* ./frontend/src/components/LedgerTable.jsx */
import React from 'react';
import { Table, Typography, Space, Button, Popconfirm } from 'antd';

const { Text } = Typography;

// Helper function to format currency
const formatMoney = (val) => {
  return Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// Helper function to format weights
const formatWeight = (val) => {
  return Number(val).toLocaleString('en-US');
};

export default function LedgerTable({ 
  tableData, 
  loading, 
  grandTotal, 
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
      align: 'center',
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
      align: 'center',
      onCell: (record) => {
        if (record.type === 'balance') return { colSpan: 0 };
        if (record.type === 'deduction') return { colSpan: 4 }; 
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
      onCell: (record) => ({ colSpan: (record.type === 'balance' || record.type === 'deduction') ? 0 : 1 }),
      render: (val, record) => {
        if (record.type === 'balance' || record.type === 'deduction' || val === '') return '';
        return formatWeight(val); // Adds commas to weight
      }
    },
    {
      title: '$', 
      dataIndex: 'price', 
      key: 'price',
      width: 80,
      onCell: (record) => ({ colSpan: (record.type === 'balance' || record.type === 'deduction') ? 0 : 1 }),
      render: (val, record) => {
        if (record.type === 'balance' || record.type === 'deduction' || !val) return '';
        return `$${formatMoney(val)}`; // Adds commas to price
      }
    },
    {
      title: 'Total', 
      dataIndex: 'total', 
      key: 'total',
      width: 120,
      render: (val, record) => {
        if (val === undefined || val === '') return '';
        const formatted = formatMoney(val); // Adds commas to total
        if (record.type === 'balance') return <strong style={{ fontSize: '15px' }}>${formatted}</strong>;
        return `$${formatted}`;
      }
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 140,
      align: 'center',
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
      summary={() => (
        <Table.Summary.Row style={{ background: '#f0f0f0' }}>
          <Table.Summary.Cell index={0} colSpan={5} align="right">
            <Text strong style={{ fontSize: '16px' }}>Remaining Balance:</Text>
          </Table.Summary.Cell>
          <Table.Summary.Cell index={1} colSpan={2}>
            <Text strong type={grandTotal < 0 ? "danger" : "success"} style={{ fontSize: '16px' }}>
              ${formatMoney(grandTotal)}
            </Text>
          </Table.Summary.Cell>
        </Table.Summary.Row>
      )}
    />
  );
}