require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');

const { attachUser } = require('./middleware/auth');
const { flashMiddleware } = require('./lib/flash');

const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const stockRoutes = require('./routes/stock');
const clientRoutes = require('./routes/clients');
const quoteRoutes = require('./routes/quotes');
const orderRoutes = require('./routes/orders');
const deliveryRoutes = require('./routes/deliveries');
const invoiceRoutes = require('./routes/invoices');
const reportRoutes = require('./routes/reports');
const settingsRoutes = require('./routes/settings');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use('/public', express.static(path.join(__dirname, '..', 'public')));

app.use(attachUser);
app.use(flashMiddleware);
app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  res.locals.user = req.user || null;
  res.locals.tenant = req.tenant || null;
  // Safe to embed inside a <script> block: escapes </script>-breaking
  // sequences so a stock item name etc. can't inject markup/script.
  res.locals.safeJson = (value) =>
    JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
  next();
});

app.get('/', (req, res) => {
  res.redirect(req.user ? '/dashboard' : '/login');
});
app.get('/healthz', (req, res) => res.status(200).send('ok'));

app.use(authRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/stock', stockRoutes);
app.use('/clients', clientRoutes);
app.use('/quotes', quoteRoutes);
app.use('/orders', orderRoutes);
app.use('/deliveries', deliveryRoutes);
app.use('/invoices', invoiceRoutes);
app.use('/reports', reportRoutes);
app.use('/settings', settingsRoutes);

app.use((req, res) => {
  res.status(404).render('404', { title: 'Not found' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('500', { title: 'Something went wrong', message: err.message });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`BizSuite listening on port ${PORT}`);
});
