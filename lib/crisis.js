'use strict';

const crypto = require('node:crypto');
const { GameError } = require('./game');

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;
const MAX_SPECTATORS = 20;
const TOTAL_ROUNDS = 3;
const WRITE_SECONDS = 90;
const VOTE_SECONDS = 45;
const RATING_SECONDS = 60;
const MAX_NAME_LENGTH = 12;
const MAX_HEADLINE = 30;
const MAX_STATEMENT = 220;
const MAX_ACTION = 80;
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const THEMES = [
  { color: '#0d9488', soft: '#d5f5ef', ink: '#063b37' },
  { color: '#2563eb', soft: '#dbe8ff', ink: '#102a56' },
  { color: '#0891b2', soft: '#d6f4fb', ink: '#083b46' },
  { color: '#16a34a', soft: '#dcfce7', ink: '#0c3a1c' },
  { color: '#7c3aed', soft: '#ede4ff', ink: '#2c1559' },
  { color: '#db2777', soft: '#fbdce9', ink: '#4c102d' },
];

const CRISES = [
  {
    id: 'milk-tea',
    title: '奶茶品牌后厨被曝使用过期原料',
    facts: ['短视频拍到后厨有过期原料', '视频播放量已破 500 万', '品牌有 300 家加盟店'],
    heat: '微博热搜第 8',
  },
  {
    id: 'gacha',
    title: '游戏公司被质疑抽卡概率造假',
    facts: ['玩家统计 1 万次抽卡', 'SSR 实际概率疑似只有公示的一半', '官方尚未回应'],
    heat: 'B 站和贴吧同时发酵',
  },
  {
    id: 'idol',
    title: '偶像被曝恋情，粉丝大规模脱粉',
    facts: ['狗仔放出约会视频', '超话出现大量脱粉帖', '明天还有品牌直播'],
    heat: '热搜第 3',
  },
  {
    id: 'launch',
    title: '科技公司发布会演示当场翻车',
    facts: ['新品演示连续三次失败', '直播弹幕刷屏“就这”', '预售已经开启'],
    heat: '科技区热榜第 1',
  },
  {
    id: 'restaurant',
    title: '餐饮老板直播时骂顾客',
    facts: ['老板在直播中情绪失控', '被骂顾客是多年老客', '录屏正在群里传播'],
    heat: '本地同城热榜',
  },
  {
    id: 'beauty',
    title: '美妆品牌被检测博主质疑成分虚标',
    facts: ['检测报告显示核心成分不足', '博主视频播放破百万', '品牌主打“敏感肌可用”'],
    heat: '小红书大量避雷帖',
  },
  {
    id: 'ad',
    title: '品牌广告被指侮辱女性',
    facts: ['广告文案引发大量投诉', '品牌方尚未撤下海报', '代言人转发过相关物料'],
    heat: '热搜第 5',
  },
  {
    id: 'layoff',
    title: '公司裁员通知被误发到全员群',
    facts: ['通知里列出裁员名单', '群内截图已外传', 'HR 还没给出正式说明'],
    heat: '职场社区热帖',
  },
  {
    id: 'livestream',
    title: '主播带货被指卖假货',
    facts: ['消费者晒出真假对比', '品牌方称授权链路没问题', '直播间仍在正常开播'],
    heat: '短视频热榜',
  },
  {
    id: 'car',
    title: '车企被多名车主投诉刹车失灵',
    facts: ['车主上传行车记录仪', '售后只回复“正常现象”', '同款车型销量很高'],
    heat: '汽车论坛置顶',
  },
  {
    id: 'endorser',
    title: '代言人突然塌房，品牌物料已铺满地铁',
    facts: ['代言人负面冲上热搜', '品牌刚官宣三天', '线下广告已经上线'],
    heat: '热搜第 1',
  },
  {
    id: 'gym',
    title: '健身房被传老板跑路',
    facts: ['门店突然停课', '会员群流传老板失联', '门口贴出“设备检修”'],
    heat: '本地同城群刷屏',
  },
  {
    id: 'coffee',
    title: '咖啡店员工被指歧视外卖骑手',
    facts: ['店员拒绝骑手使用洗手间', '现场视频被路人拍下', '门店正在排队高峰'],
    heat: '同城热搜第 2',
  },
  {
    id: 'premade',
    title: '连锁餐厅被曝大量使用预制菜',
    facts: ['后厨几乎没有现炒', '菜单仍写“现做现卖”', '客单价并不低'],
    heat: '短视频播放破千万',
  },
  {
    id: 'watch',
    title: '儿童手表被曝泄露定位信息',
    facts: ['安全研究员演示远程读取位置', '受影响设备超过 10 万台', '家长群开始集体退款'],
    heat: '科技媒体头条',
  },
  {
    id: 'ai-face',
    title: '品牌用 AI 换脸演员拍广告',
    facts: ['演员本人并不知情', '广告已经投放一周', '品牌称是“技术测试”'],
    heat: '行业媒体连续跟进',
  },
  {
    id: 'delivery',
    title: '快递公司被曝丢件后伪造签收',
    facts: ['多位用户遇到同样情况', '客服只愿意赔运费', '内部员工爆料有考核压力'],
    heat: '投诉平台集中爆发',
  },
  {
    id: 'flight',
    title: '航空公司超售导致一家三口滞留机场',
    facts: ['孩子第二天要上学', '地勤态度强硬', '现场视频被大量转发'],
    heat: '热搜第 6',
  },
  {
    id: 'hotel',
    title: '酒店被曝用毛巾擦马桶',
    facts: ['暗访视频拍到清洁过程', '酒店自称“个别员工”', '同品牌有多家门店'],
    heat: '旅游平台差评刷屏',
  },
  {
    id: 'pet',
    title: '宠物医院被指误诊导致宠物死亡',
    facts: ['主人公开完整病历', '医院拒绝提供监控', '同城养宠群正在扩散'],
    heat: '本地生活热榜',
  },
  {
    id: 'edu',
    title: '教育机构突然停课，家长排队退费',
    facts: ['老师称工资已拖欠两个月', '机构仍在促销新课', '门店负责人失联'],
    heat: '家长群和同城热搜',
  },
  {
    id: 'short-drama',
    title: '短剧被指抄袭热门小说',
    facts: ['情节和台词高度相似', '原著作者已发声', '平台仍在推荐位'],
    heat: '文娱热搜',
  },
  {
    id: 'variety',
    title: '综艺剪辑被指恶意制造矛盾',
    facts: ['嘉宾发文称被断章取义', '节目组暂未回应', '相关片段播放量很高'],
    heat: '综艺话题榜第 1',
  },
  {
    id: 'battery',
    title: '手机被曝充电时电池起火',
    facts: ['用户晒出烧毁现场', '同型号已有三起类似投诉', '官方称正在检测'],
    heat: '数码社区置顶',
  },
  {
    id: 'price',
    title: '电商平台被指大数据杀熟',
    facts: ['老用户看到的价格更贵', '不同账号差价被截图', '平台称是“随机优惠”'],
    heat: '消费维权热帖',
  },
  {
    id: 'crowdfund',
    title: '众筹项目被质疑诈捐',
    facts: ['筹款人晒出旅游照片', '金额已超过目标三倍', '平台审核流程被质疑'],
    heat: '社交平台刷屏',
  },
  {
    id: 'property',
    title: '小区物业突然停水停电',
    facts: ['物业称设备故障', '业主怀疑是催缴物业费', '老人和婴儿受到影响'],
    heat: '本地民生新闻',
  },
  {
    id: 'housing',
    title: '楼盘延期交付，业主拉横幅',
    facts: ['合同交付日已过半年', '开发商只回复“正在协调”', '现场视频被转发'],
    heat: '同城热榜第 1',
  },
  {
    id: 'festival',
    title: '音乐节临时取消，观众滞留外地',
    facts: ['开场前 3 小时才通知', '机酒损失无人承担', '主办方电话打不通'],
    heat: '社交平台维权群',
  },
  {
    id: 'esports',
    title: '电竞战队被质疑打假赛',
    facts: ['关键局出现明显失误', '聊天记录被曝光', '联盟宣布介入调查'],
    heat: '电竞热搜第 1',
  },
  {
    id: 'recruit',
    title: '公司招聘要求“35 岁以下”被指歧视',
    facts: ['岗位描述截图流出', 'HR 称是“团队年轻化”', '话题在职场社区发酵'],
    heat: '职场热榜',
  },
  {
    id: 'powerbank',
    title: '共享充电宝被曝归还后仍持续扣费',
    facts: ['多位用户晒出账单', '客服只愿意退部分费用', '设备仍在正常铺设'],
    heat: '消费投诉平台',
  },
  {
    id: 'ride',
    title: '网约车司机被指故意绕路',
    facts: ['行程多出 20 公里', '乘客录音显示司机承认绕路', '平台只补偿优惠券'],
    heat: '同城出行热帖',
  },
  {
    id: 'milk-powder',
    title: '奶粉品牌被曝检出微量问题成分',
    facts: ['检测机构公布报告', '品牌称符合旧标准', '家长开始退货'],
    heat: '母婴群刷屏',
  },
  {
    id: 'scenic',
    title: '景区被曝餐馆宰客',
    facts: ['一份普通菜收费 398 元', '游客称被威胁删除视频', '景区称商户已停业'],
    heat: '旅游热搜',
  },
  {
    id: 'medical-beauty',
    title: '医美机构被指操作失误导致顾客毁容',
    facts: ['顾客晒出术前术后照片', '机构称“恢复期正常”', '主刀医生资质被质疑'],
    heat: '本地消费维权',
  },
  {
    id: 'skin',
    title: '游戏皮肤抽奖被指概率不透明',
    facts: ['玩家统计与实际不符', '保底规则写得很隐蔽', '官方论坛大量投诉'],
    heat: '游戏社区热帖',
  },
  {
    id: 'co-brand',
    title: '咖啡联名活动被指歧视小城市',
    facts: ['活动只限一线城市门店', '海报文案引发不满', '品牌称“分批上线”'],
    heat: '热搜第 9',
  },
  {
    id: 'roadshow',
    title: '电影路演主创发言引发争议',
    facts: ['现场视频被剪成多个版本', '主创尚未正式回应', '预售已受到波及'],
    heat: '文娱热搜',
  },
  {
    id: 'bank',
    title: '银行被曝客户信息泄露',
    facts: ['大量客户收到精准诈骗电话', '内部员工疑似倒卖数据', '银行称正在排查'],
    heat: '金融安全热榜',
  },
  {
    id: 'rider',
    title: '外卖骑手与顾客冲突视频疯传',
    facts: ['双方各执一词', '平台只回复“正在核实”', '视频播放量快速上涨'],
    heat: '同城热搜第 3',
  },
];

const PHASES = new Set(['lobby', 'writing', 'voting', 'reveal']);

function cleanName(value) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, MAX_NAME_LENGTH);
}

function cleanText(value, max) {
  return String(value || '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\r\n/g, '\n')
    .trim()
    .slice(0, max);
}

function tokenEquals(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function shuffled(list) {
  const copy = [...list];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const random = crypto.randomInt(0, index + 1);
    [copy[index], copy[random]] = [copy[random], copy[index]];
  }
  return copy;
}

class CrisisStore {
  constructor(options = {}) {
    this.rooms = new Map();
    this.now = options.now || (() => Date.now());
  }

  makeRoomCode() {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      let code = '';
      for (let index = 0; index < 4; index += 1) {
        code += ROOM_CODE_ALPHABET[crypto.randomInt(0, ROOM_CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
    throw new GameError(503, '房间号用完了，稍后再试。');
  }

  createRoom(name) {
    const clean = cleanName(name);
    if (!clean) throw new GameError(400, '先给自己起个名字吧。');
    const now = this.now();
    const room = {
      code: this.makeRoomCode(),
      createdAt: now,
      updatedAt: now,
      revision: 0,
      phase: 'lobby',
      round: 0,
      totalRounds: TOTAL_ROUNDS,
      hostId: null,
      crisis: null,
      usedCrises: [],
      players: [],
      spectators: [],
      proposals: new Map(),
      votes: new Map(),
      ratings: new Map(),
      scores: new Map(),
      history: [],
      phaseEndsAt: null,
      startedAt: null,
    };
    const player = this.addPlayer(room, clean);
    room.hostId = player.id;
    this.rooms.set(room.code, room);
    return { room, player };
  }

  addPlayer(room, name) {
    const player = {
      id: crypto.randomUUID(),
      token: crypto.randomBytes(24).toString('hex'),
      name,
      seat: room.players.length,
      connected: true,
      ...THEMES[room.players.length % THEMES.length],
    };
    room.players.push(player);
    return player;
  }

  nameTaken(room, name) {
    const lower = name.toLowerCase();
    return (
      room.players.some((player) => player.name.toLowerCase() === lower) ||
      room.spectators.some((spectator) => spectator.name.toLowerCase() === lower)
    );
  }

  joinRoom(code, name) {
    const room = this.room(code);
    if (room.phase !== 'lobby') throw new GameError(409, '这一局已经开始了。');
    if (room.players.length >= MAX_PLAYERS) throw new GameError(409, '房间已经坐满了。');
    const clean = cleanName(name);
    if (!clean) throw new GameError(400, '先给自己起个名字吧。');
    if (this.nameTaken(room, clean)) throw new GameError(409, '这个名字已经被占了。');
    const player = this.addPlayer(room, clean);
    this.touch(room);
    return { room, player };
  }

  addSpectator(code, name) {
    const room = this.room(code);
    if (room.spectators.length >= MAX_SPECTATORS) {
      throw new GameError(409, '观战席已经满了。');
    }
    let clean = cleanName(name) || '观众';
    if (this.nameTaken(room, clean)) {
      for (let index = 2; index < 99; index += 1) {
        const candidate = `${clean.slice(0, 10)}${index}`;
        if (!this.nameTaken(room, candidate)) {
          clean = candidate;
          break;
        }
      }
    }
    const spectator = {
      id: crypto.randomUUID(),
      token: crypto.randomBytes(24).toString('hex'),
      name: clean,
      connected: true,
    };
    room.spectators.push(spectator);
    this.touch(room);
    return { room, spectator };
  }

  room(code) {
    const room = this.rooms.get(String(code || '').trim().toUpperCase());
    if (!room) throw new GameError(404, '房间不存在，可能已经结束了。');
    return room;
  }

  authenticate(code, memberId, token, role = 'player') {
    const room = this.room(code);
    const list = role === 'spectator' ? room.spectators : room.players;
    const member = list.find((entry) => entry.id === memberId);
    if (!member || !tokenEquals(member.token, token)) {
      throw new GameError(401, '身份已失效，请重新加入房间。');
    }
    return { room, player: role === 'player' ? member : null, spectator: role === 'spectator' ? member : null, role };
  }

  rejoin(code, playerId, token, role = 'player') {
    const auth = this.authenticate(code, playerId, token, role);
    const member = role === 'spectator' ? auth.spectator : auth.player;
    member.connected = true;
    this.touch(auth.room);
    return auth;
  }

  leave(code, playerId, token) {
    const { room, player } = this.authenticate(code, playerId, token);
    if (room.phase !== 'lobby') throw new GameError(409, '游戏开始后不能退出。');
    room.players = room.players.filter((entry) => entry.id !== player.id);
    if (room.hostId === player.id) room.hostId = room.players[0]?.id || null;
    room.players.forEach((entry, index) => { entry.seat = index; });
    if (!room.players.length) {
      this.rooms.delete(room.code);
      return { room: null, deleted: true };
    }
    this.touch(room);
    return { room, deleted: false };
  }

  leaveSpectator(code, playerId, token) {
    const { room, spectator } = this.authenticate(code, playerId, token, 'spectator');
    room.spectators = room.spectators.filter((entry) => entry.id !== spectator.id);
    this.touch(room);
    return { room };
  }

  start(code, playerId, token) {
    const { room, player } = this.authenticate(code, playerId, token);
    if (room.hostId !== player.id) throw new GameError(403, '只有房主可以开始。');
    if (room.phase !== 'lobby') throw new GameError(409, '游戏已经开始了。');
    if (room.players.length < MIN_PLAYERS) throw new GameError(409, '至少需要两个人。');
    if (room.players.length > MAX_PLAYERS) throw new GameError(409, '房间人数太多了。');

    room.history = [];
    room.scores.clear();
    room.usedCrises = [];
    room.round = 0;
    this.beginRound(room, 1);
    return { room };
  }

  beginRound(room, round) {
    let pool = CRISES.filter((item) => !room.usedCrises.includes(item.id));
    if (!pool.length) {
      room.usedCrises = [];
      pool = [...CRISES];
    }
    const crisis = shuffled(pool)[0];
    room.usedCrises.push(crisis.id);
    room.round = round;
    room.phase = 'writing';
    room.crisis = crisis;
    room.proposals.clear();
    room.votes.clear();
    room.ratings.clear();
    room.phaseEndsAt = this.now() + WRITE_SECONDS * 1000;
    room.startedAt = this.now();
    this.touch(room);
  }

  submitProposal(code, playerId, token, data) {
    const { room, player } = this.authenticate(code, playerId, token);
    if (room.phase !== 'writing') throw new GameError(409, '现在不是写提案的时间。');
    const proposal = {
      headline: cleanText(data?.headline, MAX_HEADLINE),
      statement: cleanText(data?.statement, MAX_STATEMENT),
      action: cleanText(data?.action, MAX_ACTION),
    };
    if (!proposal.headline || !proposal.statement || !proposal.action) {
      throw new GameError(400, '三部分都要写。');
    }
    room.proposals.set(player.id, proposal);
    if (room.proposals.size >= room.players.length) this.beginVoting(room);
    this.touch(room);
    return { room };
  }

  beginVoting(room) {
    room.phase = 'voting';
    room.phaseEndsAt =
      this.now() + (room.players.length === 2 ? RATING_SECONDS : VOTE_SECONDS) * 1000;
    this.touch(room);
  }

  finishWriting(room) {
    if (room.phase !== 'writing') return false;
    for (const player of room.players) {
      if (!room.proposals.has(player.id)) {
        room.proposals.set(player.id, {
          headline: '（未提交）',
          statement: '',
          action: '',
        });
      }
    }
    this.beginVoting(room);
    return true;
  }

  submitVote(code, playerId, token, targetId) {
    const { room, player } = this.authenticate(code, playerId, token);
    if (room.phase !== 'voting') throw new GameError(409, '现在不是投票时间。');
    if (room.players.length === 2) throw new GameError(409, '两人局用互评。');
    if (targetId === player.id) throw new GameError(400, '不能投自己。');
    if (!room.players.some((candidate) => candidate.id === targetId)) {
      throw new GameError(404, '找不到这个提案。');
    }
    if (room.votes.has(player.id)) throw new GameError(409, '你已经投过了。');
    room.votes.set(player.id, targetId);
    if (room.votes.size >= room.players.length) this.reveal(room);
    this.touch(room);
    return { room };
  }

  submitRating(code, playerId, token, targetId, rating) {
    const { room, player } = this.authenticate(code, playerId, token);
    if (room.phase !== 'voting') throw new GameError(409, '现在不是互评时间。');
    if (room.players.length !== 2) throw new GameError(409, '只有两人局需要互评。');
    if (targetId === player.id) throw new GameError(400, '不能给自己打分。');
    if (!room.players.some((candidate) => candidate.id === targetId)) {
      throw new GameError(404, '找不到这个提案。');
    }
    const values = ['credibility', 'execution', 'creativity'].map((key) => Number(rating?.[key]));
    if (values.some((value) => !Number.isInteger(value) || value < 1 || value > 5)) {
      throw new GameError(400, '三项评分都要在 1–5 分之间。');
    }
    if (room.ratings.has(player.id)) throw new GameError(409, '你已经评过分了。');
    room.ratings.set(player.id, {
      targetId,
      credibility: values[0],
      execution: values[1],
      creativity: values[2],
    });
    if (room.ratings.size >= 2) this.reveal(room);
    this.touch(room);
    return { room };
  }

  finishVoting(room) {
    if (room.phase !== 'voting') return false;
    this.reveal(room);
    return true;
  }

  reveal(room) {
    const ratingMode = room.players.length === 2;
    const entries = room.players.map((player) => {
      const proposal = room.proposals.get(player.id) || {
        headline: '（未提交）',
        statement: '',
        action: '',
      };
      let votes = 0;
      let rating = null;
      let points = 0;
      if (ratingMode) {
        const given = room.ratings.get(
          room.players.find((candidate) => candidate.id !== player.id)?.id,
        );
        if (given) {
          rating = {
            credibility: given.credibility,
            execution: given.execution,
            creativity: given.creativity,
            total: given.credibility + given.execution + given.creativity,
          };
          points = rating.total;
        }
      } else {
        votes = [...room.votes.values()].filter((target) => target === player.id).length;
        points = votes;
      }
      return {
        playerId: player.id,
        name: player.name,
        color: player.color,
        proposal,
        votes,
        rating,
        points,
      };
    });
    for (const entry of entries) {
      room.scores.set(entry.playerId, (room.scores.get(entry.playerId) || 0) + entry.points);
    }
    const result = {
      round: room.round,
      crisis: room.crisis,
      ratingMode,
      entries,
      isFinal: room.round >= room.totalRounds,
      revealedAt: this.now(),
    };
    room.history.push(result);
    room.phase = 'reveal';
    room.phaseEndsAt = null;
    this.touch(room);
    return result;
  }

  nextRound(code, playerId, token) {
    const { room, player } = this.authenticate(code, playerId, token);
    if (room.hostId !== player.id) throw new GameError(403, '只有房主可以开下一轮。');
    if (room.phase !== 'reveal') throw new GameError(409, '还没到下一轮。');
    if (room.round >= room.totalRounds) throw new GameError(409, '三局已经结束了。');
    this.beginRound(room, room.round + 1);
    return { room };
  }

  restart(code, playerId, token) {
    const { room, player } = this.authenticate(code, playerId, token);
    if (room.hostId !== player.id) throw new GameError(403, '只有房主可以重开。');
    if (room.phase === 'lobby') throw new GameError(409, '现在已经在准备大厅里了。');
    room.phase = 'lobby';
    room.round = 0;
    room.crisis = null;
    room.history = [];
    room.scores.clear();
    room.proposals.clear();
    room.votes.clear();
    room.ratings.clear();
    room.phaseEndsAt = null;
    this.touch(room);
    return { room };
  }

  view(room, viewerId, role = 'player') {
    const isPlayer = role === 'player';
    const viewer = isPlayer
      ? room.players.find((candidate) => candidate.id === viewerId)
      : room.spectators.find((candidate) => candidate.id === viewerId);
    if (!viewer) throw new GameError(401, '你不在这个房间里。');
    const revealing = room.phase === 'reveal';
    const ratingMode = room.players.length === 2;
    const proposals = room.proposals.size
      ? room.players.map((player) => {
          const proposal = room.proposals.get(player.id) || {
            headline: '（未提交）',
            statement: '',
            action: '',
          };
          return {
            id: player.id,
            isYou: isPlayer && player.id === viewerId,
            author: revealing ? player.name : null,
            headline: proposal.headline,
            statement: proposal.statement,
            action: proposal.action,
            votes: revealing
              ? [...room.votes.values()].filter((target) => target === player.id).length
              : null,
            rating: revealing
              ? (() => {
                  const other = room.players.find((candidate) => candidate.id !== player.id);
                  const given = other ? room.ratings.get(other.id) : null;
                  return given
                    ? {
                        credibility: given.credibility,
                        execution: given.execution,
                        creativity: given.creativity,
                        total: given.credibility + given.execution + given.creativity,
                      }
                    : null;
                })()
              : null,
          };
        })
      : [];

    return {
      code: room.code,
      revision: room.revision,
      phase: room.phase,
      round: room.round,
      totalRounds: room.totalRounds,
      hostId: room.hostId,
      role,
      minPlayers: MIN_PLAYERS,
      maxPlayers: MAX_PLAYERS,
      maxSpectators: MAX_SPECTATORS,
      crisis: room.crisis,
      phaseEndsAt: room.phaseEndsAt,
      players: room.players.map((player) => ({
        id: player.id,
        name: player.name,
        seat: player.seat,
        color: player.color,
        softColor: player.softColor,
        isHost: player.id === room.hostId,
        isYou: isPlayer && player.id === viewerId,
        submitted: room.proposals.has(player.id),
        voted: room.votes.has(player.id) || room.ratings.has(player.id),
      })),
      spectators: room.spectators.map((spectator) => ({
        id: spectator.id,
        name: spectator.name,
        isYou: !isPlayer && spectator.id === viewerId,
      })),
      spectatorCount: room.spectators.length,
      proposals,
      ratingMode,
      submittedCount: room.proposals.size,
      votedCount: room.votes.size + room.ratings.size,
      viewer: {
        id: viewer.id,
        name: viewer.name,
        isHost: isPlayer && viewer.id === room.hostId,
        isSpectator: !isPlayer,
        submitted: isPlayer && room.proposals.has(viewer.id),
        voted: isPlayer && (room.votes.has(viewer.id) || room.ratings.has(viewer.id)),
      },
      scores: revealing
        ? room.players
            .map((player) => ({ id: player.id, name: player.name, score: room.scores.get(player.id) || 0 }))
            .sort((a, b) => b.score - a.score)
        : [],
      result: revealing ? room.history[room.history.length - 1] : null,
      history: room.history,
      canStart: isPlayer && room.phase === 'lobby' && viewer.id === room.hostId && room.players.length >= MIN_PLAYERS && room.players.length <= MAX_PLAYERS,
      canNext: isPlayer && room.phase === 'reveal' && viewer.id === room.hostId && room.round < room.totalRounds,
      canRestart: isPlayer && room.phase === 'reveal' && room.round >= room.totalRounds && viewer.id === room.hostId,
      serverNow: this.now(),
    };
  }

  touch(room) {
    room.revision += 1;
    room.updatedAt = this.now();
  }
}

module.exports = {
  CrisisStore,
  GameError,
  constants: {
    MIN_PLAYERS,
    MAX_PLAYERS,
    MAX_SPECTATORS,
    TOTAL_ROUNDS,
    WRITE_SECONDS,
    VOTE_SECONDS,
    RATING_SECONDS,
    MAX_HEADLINE,
    MAX_STATEMENT,
    MAX_ACTION,
  },
};
