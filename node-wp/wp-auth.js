import axios from 'axios';
import * as cheerio from 'cheerio';

import cfg from './config.js';

let wpSessionCookies = '';
let wpRestNonce = '';

export async function wpLogin() {
  const loginUrl = `${cfg.wp.url}/wp-login.php`;
  const form = new URLSearchParams();
  form.append('log', cfg.wp.user);
  form.append('pwd', cfg.wp.pwd);
  form.append('wp-submit', 'Log In');
  form.append('redirect_to', `${cfg.wp.url}/wp-admin/`);
  form.append('testcookie', '1');

  const res = await axios.post(loginUrl, form, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Node-WP-Uploader'
    },
    maxRedirects: 0,
    validateStatus: s => s >= 200 && s < 400
  });

  const cookies = res.headers['set-cookie'] || [];
  wpSessionCookies = cookies.join('; ');
  if (!wpSessionCookies) throw new Error('登录失败，未获取会话Cookie');
}

export async function fetchNonce() {
  const adminRes = await axios.get(`${cfg.wp.url}/wp-admin/`, {
    headers: { Cookie: wpSessionCookies }
  });
  const $ = cheerio.load(adminRes.data);
  let nonce = null;
  $('script').each((_, el) => {
    const txt = $(el).html();
    const match = txt.match(/wpApiSettings\.nonce\s*=\s*["']([^"']+)["']/);
    if (match) nonce = match[1];
  });
  if (!nonce) throw new Error('无法提取X-WP-Nonce');
  wpRestNonce = nonce;
}

export async function initAuth() {
  await wpLogin();
  await fetchNonce();
}

export function getBaseHeaders() {
  return {
    Cookie: wpSessionCookies,
    'X-WP-Nonce': wpRestNonce,
    'User-Agent': 'Node-WP-Uploader'
  };
}
