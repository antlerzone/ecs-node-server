require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const accessRoutes = require('./src/modules/access/access.routes');
const billingRoutes = require('./src/modules/billing/billing.routes');
const agreementRoutes = require('./src/modules/agreement/agreement.routes');
const bankBulkTransferRoutes = require('./src/modules/bankbulktransfer/bankbulktransfer.routes');
const expensesRoutes = require('./src/modules/expenses/expenses.routes');
const downloadRoutes = require('./src/modules/download/download.routes');
const companysettingRoutes = require('./src/modules/companysetting/companysetting.routes');
const helpRoutes = require('./src/modules/help/help.routes');
const bookingRoutes = require('./src/modules/booking/booking.routes');
const ownerportalRoutes = require('./src/modules/ownerportal/ownerportal.routes');
const tenantinvoiceRoutes = require('./src/modules/tenantinvoice/tenantinvoice.routes');
const tenantdashboardRoutes = require('./src/modules/tenantdashboard/tenantdashboard.routes');
const generatereportRoutes = require('./src/modules/generatereport/generatereport.routes');
const accountRoutes = require('./src/modules/account/account.routes');
const servicesTopupRoutes = require('./src/modules/services/topup.routes');
const apiAuth = require('./src/middleware/apiAuth');
const uploadRoutes = require('./src/modules/upload/upload.routes');
const contactRoutes = require('./src/modules/contact/contact.routes');
const sqlaccountRoutes = require('./src/modules/sqlaccount/routes/sqlaccount.routes');
const roomsettingRoutes = require('./src/modules/roomsetting/roomsetting.routes');
const metersettingRoutes = require('./src/modules/metersetting/metersetting.routes');
const smartdoorsettingRoutes = require('./src/modules/smartdoorsetting/smartdoorsetting.routes');
const tenancysettingRoutes = require('./src/modules/tenancysetting/tenancysetting.routes');
const ownersettingRoutes = require('./src/modules/ownersetting/ownersetting.routes');
const propertysettingRoutes = require('./src/modules/propertysetting/propertysetting.routes');
const agreementsettingRoutes = require('./src/modules/agreementsetting/agreementsetting.routes');
const enquiryRoutes = require('./src/modules/enquiry/enquiry.routes');
const availableunitRoutes = require('./src/modules/availableunit/availableunit.routes');
const cnyiotmalaysiaRoutes = require('./src/modules/cnyiotmalaysia/cnyiotmalaysia.routes');
const app = express();

app.use(cors({
  origin: [
    'https://www.colivingjb.com',
    'https://colivingjb.com',
    /\.wixsite\.com$/,
    /\.wix\.com$/,
    /\.filesusr\.com$/   // Wix HTML iframes / embed (e.g. www-colivingjb-com.filesusr.com)
  ],
  methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
  credentials: true
}));

app.use(express.json());
// When any API returns { ok: false }, write to ticket table (page, action, function, path, reason) for later review.
const recordApiErrorMiddleware = require('./src/middleware/recordApiErrorMiddleware');
app.use(recordApiErrorMiddleware);
// 读出 table 的日期一律按 UTC+8 格式化再返回前端（datepicker 选 1 Mar = UTC+8 的 1 Mar）
const { formatApiResponseDates } = require('./src/utils/dateMalaysia');
app.use((req, res, next) => {
  const _json = res.json.bind(res);
  res.json = function (body) {
    if (req.path.startsWith('/api/') && body && typeof body === 'object') {
      formatApiResponseDates(body);
    }
    return _json(body);
  };
  next();
});
app.use('/api/access', accessRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/agreement', agreementRoutes);
app.use('/api/bank-bulk-transfer', bankBulkTransferRoutes);
app.use('/api/expenses', expensesRoutes);
app.use('/api/download', downloadRoutes);
app.use('/api/companysetting', companysettingRoutes);
app.use('/api/help', helpRoutes);
app.use('/api/enquiry', apiAuth, enquiryRoutes);
app.use('/api/availableunit', apiAuth, availableunitRoutes);
app.use('/api/booking', bookingRoutes);
app.use('/api/ownerportal', ownerportalRoutes);
app.use('/api/tenantinvoice', tenantinvoiceRoutes);
app.use('/api/tenantdashboard', tenantdashboardRoutes);
app.use('/api/generatereport', generatereportRoutes);
app.use('/api/account', accountRoutes);
app.use('/api/services/topup', servicesTopupRoutes);
app.use('/api/upload', apiAuth, uploadRoutes);
app.use('/api/contact', apiAuth, contactRoutes);
app.use('/api/roomsetting', apiAuth, roomsettingRoutes);
app.use('/api/metersetting', apiAuth, metersettingRoutes);
app.use('/api/smartdoorsetting', apiAuth, smartdoorsettingRoutes);
app.use('/api/tenancysetting', apiAuth, tenancysettingRoutes);
app.use('/api/ownersetting', apiAuth, ownersettingRoutes);
app.use('/api/propertysetting', apiAuth, propertysettingRoutes);
app.use('/api/agreementsetting', apiAuth, agreementsettingRoutes);
app.use('/api/sqlaccount', sqlaccountRoutes);
app.use('/api/cnyiotmalaysia', apiAuth, cnyiotmalaysiaRoutes);

app.get('/', (req, res) => {
  res.send('Launch Advisor Backend Running 🚀');
});

app.post('/test', (req, res) => {
  res.json({ message: 'API working' });
});

app.use((err, req, res, next) => {
  const msg = err && typeof err.message === 'string' ? err.message : String(err && err.code != null ? err.code : err);
  const status = err && typeof err.statusCode === 'number' ? err.statusCode : undefined;
  console.error('[app]', req.method, req.path, status != null ? status : '', msg);
  if (req.path.startsWith('/api/')) {
    const reason = (msg && msg.slice(0, 100)) || 'BACKEND_ERROR';
    res.status(500).json({ ok: false, reason });
    return;
  }
  res.status(500).send(msg || 'Error');
});

app.listen(3000, '0.0.0.0', () => {
  console.log('Server running on port 3000');
});