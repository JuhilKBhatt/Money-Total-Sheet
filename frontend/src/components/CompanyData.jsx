/* ./frontend/src/components/CompanyData.jsx */
import React, { useState, useEffect } from 'react';
import { Button, message, Spin, Form, Space } from 'antd';
import { PlusOutlined, DollarOutlined } from '@ant-design/icons';
import axios from 'axios';
import dayjs from 'dayjs';

import LedgerTable from './LedgerTable';
import PickupModal from './PickupModal';
import DeductionModal from './DeductionModal';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export default function CompanyData({ companyId, companyName }) {
  const [pickups, setPickups] = useState([]);
  const [deductions, setDeductions] = useState([]);
  const [yards, setYards] = useState([]);
  const [currencies, setCurrencies] = useState([]);
  const [units, setUnits] = useState([]);
  const [loading, setLoading] = useState(true);

  const [isPickupModalVisible, setIsPickupModalVisible] = useState(false);
  const [isDeductionModalVisible, setIsDeductionModalVisible] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const [pickupForm] = Form.useForm();
  const [deductionForm] = Form.useForm();

  useEffect(() => {
    fetchCompanyData();
    fetchOptions();
  }, [companyId]);

  const fetchOptions = async () => {
    try {
      const [yardsRes, currRes, unitsRes] = await Promise.all([
        axios.get(`${API_URL}/yards/`),
        axios.get(`${API_URL}/currencies/`),
        axios.get(`${API_URL}/units/`)
      ]);
      setYards(yardsRes.data);
      setCurrencies(currRes.data);
      setUnits(unitsRes.data);
    } catch (error) {
      console.error("Failed to load options");
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
    } finally {
      setLoading(false);
    }
  };

  const defaultCurrency = currencies.length > 0 ? currencies[0].label : '$';
  const defaultUnit = units.length > 0 ? units[0].value : 'kg';

  // --- Modals ---
  const openAddPickup = () => {
    setEditingId(null);
    pickupForm.resetFields();
    pickupForm.setFieldsValue({ currency: defaultCurrency });
    setIsPickupModalVisible(true);
  };

  const openEditPickup = (pickup) => {
    setEditingId(pickup.id);
    pickupForm.setFieldsValue({
      date: dayjs(pickup.date),
      yard: pickup.yard,
      notes: pickup.notes,
      currency: pickup.currency || defaultCurrency,
      metals: pickup.metals
    });
    setIsPickupModalVisible(true);
  };

  const openAddDeduction = () => {
    setEditingId(null);
    deductionForm.resetFields();
    deductionForm.setFieldsValue({ currency: defaultCurrency });
    setIsDeductionModalVisible(true);
  };

  const openEditDeduction = (deduction) => {
    setEditingId(deduction.id);
    deductionForm.setFieldsValue({
      date: dayjs(deduction.date),
      amount: deduction.amount,
      notes: deduction.notes,
      currency: deduction.currency || defaultCurrency
    });
    setIsDeductionModalVisible(true);
  };

  // --- Handlers ---
  const handlePickupSubmit = async (values) => {
    const payload = {
      company_id: companyId,
      date: values.date.format('YYYY-MM-DD'),
      yard: values.yard,
      currency: values.currency,
      notes: values.notes || "",
      deduction: 0.0,
      metals: values.metals || []
    };
    if (editingId) {
      await axios.delete(`${API_URL}/pickups/${editingId}`);
      await axios.post(`${API_URL}/pickups/`, payload);
    } else {
      await axios.post(`${API_URL}/pickups/`, payload);
    }
    setIsPickupModalVisible(false);
    setEditingId(null);
    fetchCompanyData();
  };

  const handleDeductionSubmit = async (values) => {
    const payload = {
      company_id: companyId,
      date: values.date.format('YYYY-MM-DD'),
      amount: values.amount,
      currency: values.currency,
      notes: values.notes || ""
    };
    if (editingId) {
      await axios.put(`${API_URL}/deductions/${editingId}`, payload);
    } else {
      await axios.post(`${API_URL}/deductions/`, payload);
    }
    setIsDeductionModalVisible(false);
    setEditingId(null);
    fetchCompanyData();
  };

  const handleDeletePickup = async (id) => { await axios.delete(`${API_URL}/pickups/${id}`); fetchCompanyData(); };
  const handleDeleteDeduction = async (id) => { await axios.delete(`${API_URL}/deductions/${id}`); fetchCompanyData(); };

  // --- Logic ---
  const buildLedgerData = () => {
    let events = [];
    pickups.forEach(p => events.push({ ...p, eventType: 'pickup' }));
    deductions.forEach(d => events.push({ ...d, eventType: 'deduction' }));

    events.sort((a, b) => {
      const dateA = new Date(a.date), dateB = new Date(b.date);
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
              date: dayjs(event.date).format('DD/MM/YY'),
              yardNotes: [event.yard, event.notes].filter(Boolean).join(' - '),
              metal: metal.metal_name,
              kg: metal.net_weight,
              weight_unit: metal.weight_unit || defaultUnit,
              price: metal.price_per_unit,
              total: metalTotal,
              currency: event.currency || defaultCurrency,
              rowSpan: mIndex === 0 ? metalCount : 0
            });
          });
        }
        if (!nextEvent || nextEvent.eventType === 'deduction' || (nextEvent.eventType === 'pickup' && nextEvent.date !== event.date)) {
          data.push({ key: `bal-p-${event.id}`, type: 'balance', priceLabel: 'BAL till date >', total: runningBalance, currency: event.currency || defaultCurrency });
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
          currency: event.currency || defaultCurrency,
          rowSpan: 1
        });
        if (!nextEvent || nextEvent.eventType === 'pickup') {
          data.push({ key: `bal-d-${event.id}`, type: 'balance', priceLabel: 'BAL till date >', total: runningBalance, currency: event.currency || defaultCurrency });
        }
      }
    });

    return data;
  };

  const tableData = buildLedgerData();
  const totalPickups = pickups.reduce((sum, pickup) => sum + (pickup.metals || []).reduce((mSum, metal) => mSum + (metal.total || 0), 0), 0);
  const totalDeductions = deductions.reduce((sum, deduction) => sum + (deduction.amount || 0), 0);
  const grandTotal = totalPickups - totalDeductions;

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Table section (Buttons removed from the top) */}
      {loading ? <Spin style={{ display: 'block', margin: '40px auto' }} /> : (
        <LedgerTable 
          tableData={tableData} loading={loading} grandTotal={grandTotal} defaultCurrency={defaultCurrency}
          openEditDeduction={openEditDeduction} handleDeleteDeduction={handleDeleteDeduction}
          openEditPickup={openEditPickup} handleDeletePickup={handleDeletePickup}
          companyName={companyName} 
        />
      )}

      {/* Action buttons moved to the bottom right with INCREASED SIZE */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
        <Space>
          <Button 
            type="primary" 
            size="large" 
            style={{ fontSize: '16px', fontWeight: '600', padding: '0 24px', height: '40px' }} 
            icon={<PlusOutlined />} 
            onClick={openAddPickup}
          >
            Add Pickup / Drop Off
          </Button>
          <Button 
            danger 
            type="primary" /* Added type="primary" so the red pops properly */
            size="large" 
            style={{ fontSize: '16px', fontWeight: '600', padding: '0 24px', height: '40px' }} 
            icon={<DollarOutlined />} 
            onClick={openAddDeduction}
          >
            Minus Deductions
          </Button>
        </Space>
      </div>

      <PickupModal visible={isPickupModalVisible} onCancel={() => { setIsPickupModalVisible(false); setEditingId(null); }}
        onSubmit={handlePickupSubmit} form={pickupForm} yards={yards} currencies={currencies} units={units} editingId={editingId} defaultUnit={defaultUnit} />
      
      <DeductionModal visible={isDeductionModalVisible} onCancel={() => { setIsDeductionModalVisible(false); setEditingId(null); }}
        onSubmit={handleDeductionSubmit} form={deductionForm} currencies={currencies} editingId={editingId} />
    </div>
  );
}