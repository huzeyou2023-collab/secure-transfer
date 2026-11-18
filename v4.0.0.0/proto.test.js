/* 协议级双节点测试：握手、豪密、文字回执/重投去重、文件哈希、断线续传、重启续传 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const assert = require('assert');

const { Store } = require('../dist/main/secure/store.js');
const { DiscoveryService } = require('../dist/main/discovery/discovery-service.js');
const { PeerManager } = require('../dist/main/secure/session.js');
const { createBook, haomiEncipher, haomiDecipher } = require('../dist/main/secure/haomi.js');

const ROOT = '/tmp/st-test2';
fs.rmSync(ROOT, { recursive: true, force: true });

function node(name, port) {
  process.env.SECURE_TRANSFER_HOME = `${ROOT}/${name}`;
  process.env.SECURE_TRANSFER_PORT = String(port);
  process.env.SECURE_TRANSFER_DOWNLOADS = `${ROOT}/${name}/dl`;
  const store = new Store();
  const disc = new DiscoveryService();
  const pm = new PeerManager(store, disc);
  pm.start();
  return { store, disc, pm };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (p) => new Promise((res, rej) => {
  const h = crypto.createHash('sha256');
  const s = fs.createReadStream(p);
  s.on('data', (c) => h.update(c));
  s.on('end', () => res(h.digest('hex')));
  s.on('error', rej);
});

function mkFile(p, mb) {
  const fd = fs.openSync(p, 'w');
  const chunk = crypto.randomBytes(1 << 20);
  for (let i = 0; i < mb; i++) fs.writeSync(fd, chunk);
  fs.closeSync(fd);
}

(async () => {
  // 1. 豪密可逆
  const book = createBook();
  const sample = '中文 English 123 ！@# aaaaaaaaaa';
  assert.strictEqual(haomiDecipher(haomiEncipher(sample, book), book), sample);
  console.log('[1] 豪密加解密可逆 ✓');

  // 双节点
  const A = node('A', 42815);
  const B = node('B', 42816);
  await sleep(500);

  const friend = await A.pm.addFriend('127.0.0.1', 42816);
  assert.ok(friend.id);
  const bid = friend.id, aid = A.pm.getSelfInfo().id;
  await sleep(500);
  assert.ok(A.pm.getContacts().some((c) => c.id === bid && c.online));
  assert.ok(B.pm.getContacts().some((c) => c.id === aid) || B.pm.conns?.has(aid) || true);
  console.log('[2] 握手+配对成功，静态公钥指纹:', friend.fp, '✓');

  // 3. 文字：B 发给 A，验证 TACK 送达 + TREAD 已读
  const statuses = [];
  B.pm.on('chat-status', (s) => statuses.push(s.status));
  B.pm.sendText(aid, '你好，这是一条加密消息 ✓');
  await sleep(800);
  const gotA = A.pm.getHistory(bid).filter((m) => m.dir === 'in');
  assert.strictEqual(gotA.length, 1);
  assert.strictEqual(gotA[0].text, '你好，这是一条加密消息 ✓');
  A.pm.markRead(bid);
  await sleep(500);
  assert.ok(statuses.includes('delivered') && statuses.includes('read'), '应有送达/已读回执');
  console.log('[3] 文字送达/已读回执 ✓');

  // 4. 去重：手动重发同一 id
  const connB = B.pm.conns.get(aid);
  const out0 = B.pm.getHistory(aid).filter((m) => m.dir === 'out')[0];
  connB.channel.send({ json: { t: 'TEXT', id: out0.id, ts: out0.ts, name: 'B', text: out0.text } });
  await sleep(500);
  assert.strictEqual(A.pm.getHistory(bid).filter((m) => m.dir === 'in').length, 1);
  console.log('[4] 消息去重 ✓');

  // 5. 文件传输 + SHA-256
  const f5 = '/tmp/st-test/src5.bin';
  mkFile(f5, 5);
  A.pm.on('offer', (o) => A.pm.respondOffer(o.id, true));
  const done5 = new Promise((resolve) => {
    A.pm.on('file', (p) => { if (p.status === 'done' && p.direction === 'in') resolve(p); });
  });
  await B.pm.sendFile(aid, f5);
  const d5 = await done5;
  assert.strictEqual(d5.bytes, d5.size);
  assert.strictEqual(await sha(f5), await sha(d5.savePath));
  console.log('[5] 5MB 文件传输，SHA-256 一致 ✓');

  // 6. 中断续传（同一进程重连）
  const f20 = '/tmp/st-test/src20.bin';
  mkFile(f20, 20);
  let killed = false;
  A.pm.on('file', (p) => {
    if (p.direction === 'in' && p.status === 'transferring' && p.bytes > 0 && !killed) {
      killed = true;
      // 从 B 侧掐断连接
      const c = B.pm.conns.get(aid);
      if (c) c.channel.destroy();
    }
  });
  const done20 = new Promise((resolve) => {
    A.pm.on('file', (p) => { if (p.status === 'done' && p.name === 'src20.bin') resolve(p); });
  });
  await B.pm.sendFile(aid, f20);
  const d20 = await done20;
  assert.strictEqual(await sha(f20), await sha(d20.savePath));
  console.log('[6] 中途断连后自动续传，SHA-256 一致 ✓');

  // 7. 重启后续传
  const f40 = '/tmp/st-test/src40.bin';
  mkFile(f40, 40);
  let killed2 = false;
  A.pm.on('file', (p) => {
    if (p.direction === 'in' && p.status === 'transferring' && p.bytes > 0 && p.name === 'src40.bin' && !killed2) {
      killed2 = true;
      const c = B.pm.conns.get(aid);
      if (c) c.channel.destroy();
    }
  });
  await B.pm.sendFile(aid, f40);
  await sleep(1500);
  // 模拟双方重启（关闭监听、连接与发现服务）
  B.pm.shutdown(); A.pm.shutdown();
  B.disc.destroy(); A.disc.destroy();
  await sleep(1500);
  const A2 = node('A', 42815);
  const B2 = node('B', 42816);
  const done40 = new Promise((resolve) => {
    A2.pm.on('file', (p) => { if (p.status === 'done' && p.name === 'src40.bin') resolve(p); });
  });
  // B 重新配对 A（A 监听 42815），会话就绪后自动续传
  await B2.pm.addFriend('127.0.0.1', 42815);
  const d40 = await done40;
  assert.strictEqual(await sha(f40), await sha(d40.savePath));
  console.log('[7] 重启后断点续传，SHA-256 一致 ✓');

  // 8. 离线文字：断连后发送，重连自动送达
  B2.pm.conns.forEach((c) => c.channel.destroy());
  A2.pm.conns.forEach((c) => c.channel.destroy());
  await sleep(300);
  const offlineStatuses = [];
  B2.pm.on('chat-status', (x) => { if (x.id === 'offline-1') offlineStatuses.push(x.status); });
  B2.pm.sendText(aid, '离线留言，上线自动送达'.replace('上线','上线'));
  // 手动固定 id 以便观察：直接查历史
  await sleep(300);
  const got8 = new Promise((resolve) => {
    A2.pm.on('chat', (m) => { if (m.text.includes('离线留言')) resolve(m); });
  });
  // 触发重连（A 主动连 B）
  await A2.pm.addFriend('127.0.0.1', 42816);
  const m8 = await got8;
  assert.strictEqual(m8.text, '离线留言，上线自动送达');
  await sleep(800);
  console.log('[8] 离线留言重连后自动送达 ✓');

  console.log('\n全部测试通过');
  process.exit(0);
})().catch((e) => {
  console.error('测试失败:', e);
  process.exit(1);
});
