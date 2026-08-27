// Minimal one-shot flash messages via a short-lived cookie — avoids pulling
// in express-session just for this.

function setFlash(res, type, message) {
  res.cookie('bizsuite_flash', JSON.stringify({ type, message }), {
    httpOnly: true,
    maxAge: 10000,
  });
}

function flashMiddleware(req, res, next) {
  const raw = req.cookies && req.cookies.bizsuite_flash;
  res.locals.flash = null;
  if (raw) {
    try {
      res.locals.flash = JSON.parse(raw);
    } catch (e) {
      // ignore malformed cookie
    }
    res.clearCookie('bizsuite_flash');
  }
  next();
}

module.exports = { setFlash, flashMiddleware };
