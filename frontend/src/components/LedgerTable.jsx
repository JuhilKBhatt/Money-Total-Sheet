/* ./frontend/src/components/LedgerTable.jsx */
import React from 'react';
import { Table, Typography, Space, Button, Popconfirm } from 'antd';

const { Text } = Typography;

const formatMoney = (val) => Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatWeight = (val) => Number(val).toLocaleString('en-US');

export default function LedgerTable({ 
  tableData, loading, grandTotal, defaultCurrency, openEditDeduction, handleDeleteDeduction, openEditPickup, handleDeletePickup, companyName 
}) {
  
  const columns = [
    {
      title: 'Date', dataIndex: 'date', key: 'date', width: 90, align: 'center',
      onCell: (record) => {
        if (record.type === 'balance') return { colSpan: 5 };
        return { rowSpan: record.rowSpan !== undefined ? record.rowSpan : 1 };
      },
      render: (val, record) => record.type === 'balance' ? <div style={{ textAlign: 'right', fontWeight: 'bold' }}>{record.priceLabel}</div> : val
    },
    {
      title: 'Yard & Notes', dataIndex: 'yardNotes', key: 'yardNotes', width: 220, align: 'center',
      onCell: (record) => {
        if (record.type === 'balance') return { colSpan: 0 };
        if (record.type === 'deduction') return { colSpan: 4 }; 
        return { rowSpan: record.rowSpan !== undefined ? record.rowSpan : 1 };
      }
    },
    {
      title: 'Metal', dataIndex: 'metal', key: 'metal', width: 120,
      onCell: (record) => ({ colSpan: (record.type === 'balance' || record.type === 'deduction') ? 0 : 1 })
    },
    {
      title: 'Weight', dataIndex: 'kg', key: 'kg', width: 100,
      onCell: (record) => ({ colSpan: (record.type === 'balance' || record.type === 'deduction') ? 0 : 1 }),
      render: (val, record) => (val === '' || val == null) ? '' : `${formatWeight(val)} ${record.weight_unit}`
    },
    {
      title: 'Price', dataIndex: 'price', key: 'price', width: 100,
      onCell: (record) => ({ colSpan: (record.type === 'balance' || record.type === 'deduction') ? 0 : 1 }),
      render: (val, record) => (!val) ? '' : `${record.currency}${formatMoney(val)}`
    },
    {
      title: 'Total', dataIndex: 'total', key: 'total', width: 120,
      onCell: (record) => {
        if (record.type === 'balance') return { colSpan: 2 };
        return {};
      },
      render: (val, record) => {
        if (val === undefined || val === '') return '';
        const curr = record.currency || '$';
        
        if (record.type === 'balance') return <strong style={{ fontSize: '16px' }}>{curr}{formatMoney(val)}</strong>;
        
        if (record.type === 'deduction') return `-${curr}${formatMoney(val)}`;
        
        return `${curr}${formatMoney(val)}`;
      }
    },
    {
      title: 'Actions', key: 'actions', width: 120, align: 'center', className: 'table-actions-col',
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
      title={() => (
        <div className="ledger-repeating-title">
          {Array(8).fill(`${(companyName || 'COMPANY').toUpperCase()}`).join(' \u00A0\u00A0•\u00A0\u00A0 ')}
        </div>
      )}
      rowClassName={(record) => {
        if (record.type === 'deduction') return 'row-deduction';
        if (record.type === 'balance') return 'row-balance';
        return '';
      }}
      summary={() => (
        <Table.Summary.Row style={{ background: '#f0f0f0' }}>
          <Table.Summary.Cell index={0} colSpan={5} align="right"><Text strong style={{ fontSize: '18px', color: '#000' }}>Remaining Balance:</Text></Table.Summary.Cell>
          <Table.Summary.Cell index={1} colSpan={2}>
            <Text strong type={grandTotal < 0 ? "danger" : "success"} style={{ fontSize: '18px' }}>
              {defaultCurrency}{formatMoney(grandTotal)}
            </Text>
          </Table.Summary.Cell>
        </Table.Summary.Row>
      )}
    />
  );
}