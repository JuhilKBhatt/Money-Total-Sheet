/* ./frontend/src/components/CompanyData.jsx */
import React, { useState, useEffect } from 'react';
import { Button, message, Spin, Form, Space } from 'antd';
import { PlusOutlined, FallOutlined } from '@ant-design/icons';
import axios from 'axios';
import dayjs from 'dayjs';

import LedgerTable from './LedgerTable';
import PickupModal from './PickupModal';
import DeductionModal from './DeductionModal';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export default function CompanyData({ companyId }) {
  const [pickups, setPickups] = useState([]);
  const [deductions, setDeductions] = useState([]);
  const [yards, setYards] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modals & Editing State
  const [isPickupModalVisible, setIsPickupModalVisible] = useState(false);
  const [isDeductionModalVisible, setIsDeductionModalVisible] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const [pickupForm] = Form.useForm();
  const [deductionForm] = Form.useForm();

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
      metals: pickup.metals
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
        const metalCount = event.metals && event.metals.length > 0 ? event.metals.length : 1;

        if (event.metals && event.metals.length > 0) {
          event.metals.forEach((metal, mIndex) => {
            const metalTotal = metal.net_weight * metal.price_per_unit;
            runningBalance += metalTotal;
            
            data.push({
              key: `metal-${metal.id}`,
              type: 'metal',
              rawPickup: event,
              date: dayjs(event.date).format('DD/MM/YY'), // Always populate, rowSpan handles the visual merge
              yardNotes: [event.yard, event.notes].filter(Boolean).join(' - '),
              metal: metal.metal_name,
              kg: metal.net_weight,
              price: metal.price_per_unit,
              total: metalTotal,
              rowSpan: mIndex === 0 ? metalCount : 0 // Instructs Ant Design to merge this cell vertically
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
          rowSpan: 1
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
    const totalPickups = pickups.reduce((sum, pickup) => {
    const metalsTotal = (pickup.metals || []).reduce((mSum, metal) => mSum + (metal.total || 0), 0);
    return sum + metalsTotal;
  }, 0);
  const totalDeductions = deductions.reduce((sum, deduction) => sum + (deduction.amount || 0), 0);
  const grandTotal = totalPickups - totalDeductions
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
        <LedgerTable 
          tableData={tableData}
          loading={loading}
          grandTotal={grandTotal}
          openEditDeduction={openEditDeduction}
          handleDeleteDeduction={handleDeleteDeduction}
          openEditPickup={openEditPickup}
          handleDeletePickup={handleDeletePickup}
        />
      )}

      <PickupModal 
        visible={isPickupModalVisible}
        onCancel={() => { setIsPickupModalVisible(false); pickupForm.resetFields(); setEditingId(null); }}
        onSubmit={handlePickupSubmit}
        form={pickupForm}
        yards={yards}
        editingId={editingId}
      />

      <DeductionModal 
        visible={isDeductionModalVisible}
        onCancel={() => { setIsDeductionModalVisible(false); deductionForm.resetFields(); setEditingId(null); }}
        onSubmit={handleDeductionSubmit}
        form={deductionForm}
        editingId={editingId}
      />
    </div>
  );
}