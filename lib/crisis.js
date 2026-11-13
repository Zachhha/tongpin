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
const MAX_PROPOSAL = 400;
const ANON_LABELS = [
  '温吞的🍎',
  '曼妙的🫐',
  '性温的🫚',
  '有性格的🍊',
  '有内核的🥭',
  '很荞麦的🍜',
  '很多的💐',
];
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
    "id": "ent-001",
    "title": "红毯空场一分钟",
    "facts": [
      "红毯环节空场一分多钟",
      "主持人现场漏麦",
      "两位临时救场演员被指抢位"
    ],
    "heat": "热搜第 5"
  },
  {
    "id": "ent-002",
    "title": "生图妆容翻车",
    "facts": [
      "活动生图被吐槽妆面显脏",
      "粉丝追问工作室",
      "妆造团队未回应"
    ],
    "heat": "时尚话题榜"
  },
  {
    "id": "ent-003",
    "title": "两套高定抢位",
    "facts": [
      "同一场活动两套高定",
      "被指抢占压轴时段",
      "团队称按品牌安排"
    ],
    "heat": "红毯热搜"
  },
  {
    "id": "ent-004",
    "title": "晚宴座位 C 位",
    "facts": [
      "晚宴座次图流出",
      "顶流被安排在边桌",
      "粉丝质疑主办方看人下菜"
    ],
    "heat": "饭圈热帖"
  },
  {
    "id": "ent-005",
    "title": "杂志封面被换",
    "facts": [
      "官宣封面临时换人",
      "原定艺人已拍完",
      "杂志称排版调整"
    ],
    "heat": "时尚圈刷屏"
  },
  {
    "id": "ent-006",
    "title": "借来的高定损坏",
    "facts": [
      "高定礼服归还时出现破损",
      "品牌要求赔偿",
      "团队称运输问题"
    ],
    "heat": "品牌纠纷"
  },
  {
    "id": "ent-007",
    "title": "造型被指抄袭",
    "facts": [
      "红毯造型被指撞款海外艺人",
      "造型师称独立设计",
      "网友做对比图"
    ],
    "heat": "时尚热搜"
  },
  {
    "id": "ent-008",
    "title": "摄影师出图太慢",
    "facts": [
      "活动结束三天没出图",
      "粉丝围攻工作室",
      "摄影师称在修片"
    ],
    "heat": "粉丝维权"
  },
  {
    "id": "ent-009",
    "title": "礼服撞衫",
    "facts": [
      "两位女艺人同场撞衫",
      "双方粉丝比状态",
      "品牌认领其中一位"
    ],
    "heat": "红毯话题"
  },
  {
    "id": "ent-010",
    "title": "红毯顺序争议",
    "facts": [
      "出场顺序被指按流量排",
      "前辈被排在后",
      "主办方称流程需要"
    ],
    "heat": "热搜第 9"
  },
  {
    "id": "ent-011",
    "title": "品牌认领翻车",
    "facts": [
      "品牌只认领一位艺人",
      "另一位粉丝要求道歉",
      "品牌删帖"
    ],
    "heat": "品牌热搜"
  },
  {
    "id": "ent-012",
    "title": "精修和生图差距",
    "facts": [
      "官方精修图与现场生图差距大",
      "网友嘲讽",
      "工作室称光线问题"
    ],
    "heat": "颜值话题"
  },
  {
    "id": "ent-013",
    "title": "海报番位大战",
    "facts": [
      "双人海报左右位置引发番位战",
      "双方工作室都不转发"
    ],
    "heat": "剧集热搜"
  },
  {
    "id": "ent-014",
    "title": "红毯赖着不走",
    "facts": [
      "被曝红毯停留过久",
      "后面艺人被迫加速",
      "团队称听从现场安排"
    ],
    "heat": "时尚热榜"
  },
  {
    "id": "ent-015",
    "title": "上映五天撤档",
    "facts": [
      "电影上映五天票房惨淡",
      "突然撤档",
      "主演还在路演，现场被问懵"
    ],
    "heat": "电影热榜"
  },
  {
    "id": "ent-016",
    "title": "票房注水质疑",
    "facts": [
      "午夜场满座但无人",
      "被质疑锁场",
      "片方称是粉丝包场"
    ],
    "heat": "票房话题"
  },
  {
    "id": "ent-017",
    "title": "主题曲旋律相似",
    "facts": [
      "新歌被指与海外歌曲相似",
      "律师称不构成法律抄袭",
      "粉丝要求平台说明"
    ],
    "heat": "文娱热搜"
  },
  {
    "id": "ent-018",
    "title": "选角不符合原著",
    "facts": [
      "主角年龄和原著不符",
      "书粉刷退票",
      "制片人称看重演技"
    ],
    "heat": "剧集热搜"
  },
  {
    "id": "ent-019",
    "title": "剧本提前泄露",
    "facts": [
      "大结局剧本流出",
      "剧方称将追责",
      "网友提前剧透"
    ],
    "heat": "剧圈刷屏"
  },
  {
    "id": "ent-020",
    "title": "结局烂尾",
    "facts": [
      "大结局被骂烂尾",
      "编剧发文暗指平台改戏",
      "平台未回应"
    ],
    "heat": "热搜第 4"
  },
  {
    "id": "ent-021",
    "title": "配角加戏",
    "facts": [
      "配角戏份超过主角",
      "主角粉丝维权",
      "剧方称群像叙事"
    ],
    "heat": "剧集话题"
  },
  {
    "id": "ent-022",
    "title": "预告片诈骗",
    "facts": [
      "预告里的名场面正片没有",
      "观众要求退票",
      "片方称是概念预告"
    ],
    "heat": "电影热帖"
  },
  {
    "id": "ent-023",
    "title": "原声台词争议",
    "facts": [
      "主演原声被指含糊",
      "粉丝称是现场收音",
      "配音演员发文内涵"
    ],
    "heat": "演技话题"
  },
  {
    "id": "ent-024",
    "title": "海报署名遗漏",
    "facts": [
      "主演名字在海报上被漏掉",
      "工作室要求更正",
      "片方道歉"
    ],
    "heat": "剧集热搜"
  },
  {
    "id": "ent-025",
    "title": "导演路演发言",
    "facts": [
      "导演称观众看不懂是审美问题",
      "现场视频疯传",
      "片方紧急灭火"
    ],
    "heat": "电影热搜"
  },
  {
    "id": "ent-026",
    "title": "电影节落选",
    "facts": [
      "热门片未入围",
      "粉丝质疑评审",
      "评委称风格不匹配"
    ],
    "heat": "影展话题"
  },
  {
    "id": "ent-027",
    "title": "平台排播临时撤",
    "facts": [
      "定档当天被撤",
      "平台称技术原因",
      "主演粉丝要求说明"
    ],
    "heat": "剧集热榜"
  },
  {
    "id": "ent-028",
    "title": "二搭传闻",
    "facts": [
      "两位主演被传二搭",
      "双方唯粉拒绝",
      "制片人称在接触"
    ],
    "heat": "CP 话题"
  },
  {
    "id": "ent-029",
    "title": "直播空镜一分多钟",
    "facts": [
      "直播空镜超一分钟",
      "网友误骂救场嘉宾",
      "节目组未说明原因"
    ],
    "heat": "综艺热搜"
  },
  {
    "id": "ent-030",
    "title": "旧友和解被拒",
    "facts": [
      "节目安排多年未联系的朋友重聚",
      "嘉宾当场拒绝和解",
      "网友指消费旧情"
    ],
    "heat": "综艺热榜"
  },
  {
    "id": "ent-031",
    "title": "剪辑制造冲突",
    "facts": [
      "嘉宾一句话被剪成争吵",
      "嘉宾发文称断章取义",
      "节目组未回应"
    ],
    "heat": "综艺话题"
  },
  {
    "id": "ent-032",
    "title": "嘉宾镜头太少",
    "facts": [
      "官宣常驻却几乎没镜头",
      "粉丝维权",
      "节目组称时长有限"
    ],
    "heat": "饭圈热帖"
  },
  {
    "id": "ent-033",
    "title": "评分被指黑幕",
    "facts": [
      "现场投票结果与路透不符",
      "观众质疑控票",
      "节目组称流程合规"
    ],
    "heat": "综艺热搜"
  },
  {
    "id": "ent-034",
    "title": "主持人漏麦",
    "facts": [
      "主持人现场漏麦",
      "流程混乱",
      "节目组道歉"
    ],
    "heat": "直播事故"
  },
  {
    "id": "ent-035",
    "title": "恋综剧本痕迹",
    "facts": [
      "嘉宾互动被指按剧本演",
      "素人发文暗示",
      "节目组否认"
    ],
    "heat": "恋综话题"
  },
  {
    "id": "ent-036",
    "title": "竞技淘汰不公",
    "facts": [
      "实力选手被淘汰",
      "评委打分遭质疑",
      "节目组称尊重赛制"
    ],
    "heat": "综艺热榜"
  },
  {
    "id": "ent-037",
    "title": "嘉宾片酬曝光",
    "facts": [
      "网传嘉宾片酬差距大",
      "节目组称不实",
      "粉丝要求公开"
    ],
    "heat": "行业八卦"
  },
  {
    "id": "ent-038",
    "title": "后台花絮外泄",
    "facts": [
      "后台抱怨被剪进花絮",
      "艺人被指耍大牌",
      "节目组删片"
    ],
    "heat": "综艺热搜"
  },
  {
    "id": "ent-039",
    "title": "游戏环节受伤",
    "facts": [
      "录制中嘉宾受伤",
      "粉丝要求停录",
      "节目组称已送医"
    ],
    "heat": "安全争议"
  },
  {
    "id": "ent-040",
    "title": "临时缺席录制",
    "facts": [
      "嘉宾临时缺席",
      "节目组改流程",
      "粉丝称是公司安排冲突"
    ],
    "heat": "综艺热帖"
  },
  {
    "id": "ent-041",
    "title": "深夜约会传闻",
    "facts": [
      "被拍到与圈外人同回公寓",
      "多个粉丝站关站",
      "公司暂未回应"
    ],
    "heat": "热搜第 4"
  },
  {
    "id": "ent-042",
    "title": "付费直播怼粉",
    "facts": [
      "付费直播中情绪失控",
      "对粉丝说“别管我”",
      "公司代道歉并暂停活动"
    ],
    "heat": "韩娱热搜"
  },
  {
    "id": "ent-043",
    "title": "新成员被指陪衬",
    "facts": [
      "新歌镜头分配悬殊",
      "粉丝租卡车抗议",
      "公司称按舞台效果安排"
    ],
    "heat": "韩娱论坛热帖"
  },
  {
    "id": "ent-044",
    "title": "合约人权条款",
    "facts": [
      "成员提出解约",
      "称合约含不合理人权条款",
      "公司否认"
    ],
    "heat": "娱乐头版"
  },
  {
    "id": "ent-045",
    "title": "男团成员解约",
    "facts": [
      "宣布与公司终止合约",
      "称被雪藏近一年",
      "公司指其违约接私活"
    ],
    "heat": "热搜第 7"
  },
  {
    "id": "ent-046",
    "title": "私生活谣言",
    "facts": [
      "匿名账号编造私生活故事",
      "公司称已取证报警",
      "粉丝要求平台删帖"
    ],
    "heat": "热搜第 2"
  },
  {
    "id": "ent-047",
    "title": "一句“不舒服”，家人店铺被刷差评",
    "facts": [
      "凌晨发文称当时确实不舒服",
      "“不舒服文学”登上热搜",
      "父亲炸串店遭差评，生意下降约 40%"
    ],
    "heat": "热搜第 1"
  },
  {
    "id": "ent-048",
    "title": "生日会全开麦",
    "facts": [
      "生日会全开麦翻唱中文歌",
      "发音获赞",
      "被质疑刻意讨好市场"
    ],
    "heat": "韩娱热搜"
  },
  {
    "id": "ent-049",
    "title": "舞台事故",
    "facts": [
      "升降台故障导致表演中断",
      "成员受伤",
      "主办方称设备检修"
    ],
    "heat": "演出事故"
  },
  {
    "id": "ent-050",
    "title": "成员旧伤复发",
    "facts": [
      "成员因旧伤暂停活动",
      "粉丝要求公司减行程",
      "公司称会调整"
    ],
    "heat": "饭圈热帖"
  },
  {
    "id": "ent-051",
    "title": "专辑无限延期",
    "facts": [
      "专辑多次延期",
      "粉丝要求公司说明",
      "公司称在打磨质量"
    ],
    "heat": "韩娱热榜"
  },
  {
    "id": "ent-052",
    "title": "概念被指抄袭",
    "facts": [
      "新专预告被指抄袭海外艺人",
      "公司称原创",
      "网友做对比"
    ],
    "heat": "韩娱争议"
  },
  {
    "id": "ent-053",
    "title": "粉丝卡车维权",
    "facts": [
      "粉丝租卡车停在公司楼下",
      "要求更换运营团队",
      "公司称会沟通"
    ],
    "heat": "饭圈刷屏"
  },
  {
    "id": "ent-054",
    "title": "应援色冲突",
    "facts": [
      "新团应援色撞前辈团",
      "双方粉丝互撕",
      "公司未回应"
    ],
    "heat": "饭圈热帖"
  },
  {
    "id": "ent-055",
    "title": "公司粉丝准则",
    "facts": [
      "公司罕见列出五项准则",
      "被指通篇归责粉丝",
      "引发大规模反弹"
    ],
    "heat": "饭圈热搜第 1"
  },
  {
    "id": "ent-056",
    "title": "队内霸凌传闻",
    "facts": [
      "匿名帖称某成员被孤立",
      "公司称造谣",
      "粉丝要求告黑"
    ],
    "heat": "韩娱热搜"
  },
  {
    "id": "ent-057",
    "title": "资源分配不公",
    "facts": [
      "同一成员连续缺席资源",
      "粉丝质疑雪藏",
      "公司称个人行程"
    ],
    "heat": "饭圈维权"
  },
  {
    "id": "ent-058",
    "title": "巡演临时取消",
    "facts": [
      "巡演场次临时取消",
      "机酒损失无人承担",
      "主办方称不可抗力"
    ],
    "heat": "演出热榜"
  },
  {
    "id": "ent-059",
    "title": "成员退团",
    "facts": [
      "成员宣布退团",
      "组合改为 N 人活动",
      "粉丝要求保留原配置"
    ],
    "heat": "韩娱热搜"
  },
  {
    "id": "ent-060",
    "title": "男演员演唱会全翻唱",
    "facts": [
      "全场曲目均为翻唱",
      "最高票价 2278 元",
      "被质疑没有代表作"
    ],
    "heat": "演出热榜第 1"
  },
  {
    "id": "ent-061",
    "title": "女团成员闪避男高管贴面礼",
    "facts": [
      "品牌活动上男高管靠近行贴面礼",
      "女团成员侧身闪避",
      "被批不专业，本人否认故意"
    ],
    "heat": "韩娱热搜"
  },
  {
    "id": "ent-062",
    "title": "双人舞台营业过度",
    "facts": [
      "双人舞台后 CP 粉暴涨",
      "公司连发双人花絮",
      "唯粉要求解绑"
    ],
    "heat": "饭圈热搜第 1"
  },
  {
    "id": "ent-063",
    "title": "公司冷处理 CP",
    "facts": [
      "颁奖礼互动被放大",
      "公司删双人物料",
      "CP 粉抵制团体活动"
    ],
    "heat": "韩娱论坛热帖"
  },
  {
    "id": "ent-064",
    "title": "CP 合体代言",
    "facts": [
      "品牌签双人代言",
      "唯粉刷拒绝捆绑",
      "品牌撤双人物料只留单人"
    ],
    "heat": "品牌热搜"
  },
  {
    "id": "ent-065",
    "title": "CP 灯牌被禁",
    "facts": [
      "CP 粉准备大规模双人灯牌",
      "主办方临时禁止",
      "现场争执"
    ],
    "heat": "演出热榜"
  },
  {
    "id": "ent-066",
    "title": "唯粉 CP 粉互撕",
    "facts": [
      "双人舞台后双方粉群开战",
      "词条刷上热搜",
      "公司发倡议书"
    ],
    "heat": "饭圈热搜"
  },
  {
    "id": "ent-067",
    "title": "真人 CP 反噬",
    "facts": [
      "剧集 CP 营销过度",
      "真人 CP 粉壮大",
      "唯粉要求只嗑角色"
    ],
    "heat": "剧集热搜"
  },
  {
    "id": "ent-068",
    "title": "CP 粉大屏应援",
    "facts": [
      "CP 粉租商圈大屏",
      "公司称未经授权使用肖像",
      "应援被叫停"
    ],
    "heat": "饭圈热帖"
  },
  {
    "id": "ent-069",
    "title": "造谣跨团 CP",
    "facts": [
      "匿名账号编造私下约会",
      "公司称取证追责",
      "粉丝要求平台处理"
    ],
    "heat": "韩娱热搜"
  },
  {
    "id": "ent-070",
    "title": "站姐跑路",
    "facts": [
      "站姐收钱代购小卡后失联",
      "粉丝报警",
      "公司称与官方无关"
    ],
    "heat": "饭圈维权"
  },
  {
    "id": "ent-071",
    "title": "机场围堵",
    "facts": [
      "粉丝机场围堵导致秩序混乱",
      "工作室发文呼吁",
      "机场加强安保"
    ],
    "heat": "热搜第 8"
  },
  {
    "id": "ent-072",
    "title": "礼物争议",
    "facts": [
      "后援会高价礼物去向不明",
      "粉丝要求公开账目",
      "后援会解散"
    ],
    "heat": "饭圈热帖"
  },
  {
    "id": "ent-073",
    "title": "生日应援攀比",
    "facts": [
      "多家粉丝会拼大屏和无人机",
      "被批铺张",
      "艺人发文劝停"
    ],
    "heat": "饭圈话题"
  },
  {
    "id": "ent-074",
    "title": "私生跟车",
    "facts": [
      "私生跟车导致追尾",
      "工作室报警",
      "粉丝要求严惩"
    ],
    "heat": "社会新闻"
  },
  {
    "id": "ent-075",
    "title": "粉丝把城市热线打爆",
    "facts": [
      "男团演唱会前后，粉丝为应援诉求集中拨打城市服务热线",
      "10 天近 5 万件诉求",
      "夜班接线员临时增援，平台禁言多个组织账号"
    ],
    "heat": "全网热议"
  },
  {
    "id": "ent-076",
    "title": "官宣写错名字",
    "facts": [
      "品牌官宣海报把代言人名字写错",
      "粉丝要求正式道歉",
      "品牌称已追责"
    ],
    "heat": "品牌热搜"
  },
  {
    "id": "ent-077",
    "title": "首日销售破纪录",
    "facts": [
      "代言首日 GMV 破 6000 万",
      "被质疑粉丝冲销量",
      "品牌称数据真实"
    ],
    "heat": "消费热搜"
  },
  {
    "id": "ent-078",
    "title": "品牌双标",
    "facts": [
      "同款产品国内外价格不同",
      "消费者质疑双标",
      "品牌称税费差异"
    ],
    "heat": "消费维权"
  },
  {
    "id": "ent-079",
    "title": "代言人塌房",
    "facts": [
      "代言人负面冲上热搜",
      "品牌官宣仅三天",
      "线下广告连夜撤换"
    ],
    "heat": "热搜第 1"
  },
  {
    "id": "ent-080",
    "title": "合约到期不续",
    "facts": [
      "品牌不再续约",
      "粉丝称被过河拆桥",
      "品牌称正常调整"
    ],
    "heat": "商业八卦"
  },
  {
    "id": "ent-081",
    "title": "直播翻车",
    "facts": [
      "代言人直播说错产品卖点",
      "品牌紧急切镜头",
      "粉丝要求重播"
    ],
    "heat": "直播热榜"
  },
  {
    "id": "ent-082",
    "title": "价格争议",
    "facts": [
      "品牌新品涨价",
      "被指割粉丝",
      "品牌称原料上涨"
    ],
    "heat": "消费热搜"
  },
  {
    "id": "ent-083",
    "title": "假货风波",
    "facts": [
      "消费者称买到假货",
      "品牌称授权链路没问题",
      "平台介入"
    ],
    "heat": "消费维权"
  },
  {
    "id": "ent-084",
    "title": "广告被下架",
    "facts": [
      "广告文案被指冒犯",
      "品牌撤下海报",
      "代言人转发过物料"
    ],
    "heat": "品牌热搜"
  },
  {
    "id": "ent-085",
    "title": "线下活动取消",
    "facts": [
      "品牌活动临时取消",
      "粉丝已到场",
      "品牌称不可抗力"
    ],
    "heat": "同城热搜"
  },
  {
    "id": "ent-086",
    "title": "品牌 title 争议",
    "facts": [
      "品牌给的头衔被指降级",
      "粉丝要求更正",
      "品牌称是长期合作"
    ],
    "heat": "饭圈热帖"
  },
  {
    "id": "ent-087",
    "title": "竞品同框",
    "facts": [
      "代言人被拍到使用竞品",
      "品牌称是私人物品",
      "粉丝要求解约"
    ],
    "heat": "商业争议"
  },
  {
    "id": "ent-088",
    "title": "高价票视线被挡",
    "facts": [
      "1288 元票被舞台挡住",
      "观众现场喊退票",
      "主办方称处理退票"
    ],
    "heat": "热搜第 3"
  },
  {
    "id": "ent-089",
    "title": "明星监制短剧，预告被指抄袭",
    "facts": [
      "赵某思投资并监制短剧",
      "预告片被指与《逐玉》相似",
      "播放量约 5000 万，演员称收入看观众认可"
    ],
    "heat": "文娱热搜"
  },
  {
    "id": "ent-090",
    "title": "黄牛票",
    "facts": [
      "开票秒空，二手平台翻倍",
      "粉丝质疑内部留票",
      "主办方称已报警"
    ],
    "heat": "演出热搜"
  },
  {
    "id": "ent-091",
    "title": "退票难",
    "facts": [
      "观众因行程申请退票",
      "平台收高额手续费",
      "主办方称按规则"
    ],
    "heat": "消费维权"
  },
  {
    "id": "ent-092",
    "title": "艺人迟到",
    "facts": [
      "演唱会延迟一小时开场",
      "观众喊退票",
      "主办方称交通原因"
    ],
    "heat": "演出事故"
  },
  {
    "id": "ent-093",
    "title": "音响故障",
    "facts": [
      "现场音响连续断音",
      "歌手清唱救场",
      "主办方道歉"
    ],
    "heat": "演出热榜"
  },
  {
    "id": "ent-094",
    "title": "嘉宾喧宾夺主",
    "facts": [
      "嘉宾表演时长超过主角",
      "粉丝不满",
      "主办方称特别环节"
    ],
    "heat": "演出话题"
  },
  {
    "id": "ent-095",
    "title": "临时取消",
    "facts": [
      "演唱会开场前取消",
      "机酒损失无人承担",
      "主办方称不可抗力"
    ],
    "heat": "热搜第 2"
  },
  {
    "id": "ent-096",
    "title": "短剧抄袭",
    "facts": [
      "新短剧被指抄袭小说",
      "台词和分镜高度相似",
      "平台仍在推荐"
    ],
    "heat": "文娱热榜"
  },
  {
    "id": "ent-097",
    "title": "演员解约与刑事谣言",
    "facts": [
      "演员宣布解约",
      "网络传出涉嫌刑事犯罪",
      "演员晒无犯罪记录"
    ],
    "heat": "短剧圈刷屏"
  },
  {
    "id": "ent-098",
    "title": "直播卖假货",
    "facts": [
      "主播带货被指卖假货",
      "消费者晒真假对比",
      "品牌称授权链路没问题"
    ],
    "heat": "直播热榜"
  },
  {
    "id": "ent-099",
    "title": "MCN 合约纠纷",
    "facts": [
      "网红称被 MCN 压榨",
      "公司称投入巨大",
      "双方互相起诉"
    ],
    "heat": "行业八卦"
  },
  {
    "id": "ent-100",
    "title": "AI 换脸代言",
    "facts": [
      "品牌用 AI 换脸演员拍广告",
      "演员本人不知情",
      "品牌称技术测试"
    ],
    "heat": "科技娱乐热搜"
  }
];

// Detailed "short news" for selected cards. Names are masked; all entries
// are adapted from public reports. More cards can be added over time.
const CRISIS_DETAILS = {
  'ent-001': `2026 年 10 月，上海某时尚杂志年度盛典。红毯环节因主持人麦克风故障空场约一分多钟，赵某思、白某等艺人先后临时救场。\n\n随后有现场视频称赵某思准备了两套高定，并“抢压轴”，其团队回应称全程按品牌与主办方流程走；白某粉丝则要求主办方解释镜头与采访顺序。截至发稿，主办方未公开完整流程表。\n\n（据公开报道改编）`,
  'ent-017': `2026 年 10 月，白某发布个人单曲。上线后有网友指出，副歌旋律与一首海外歌曲高度相似，相关对比视频迅速传播。\n\n白某工作室称歌曲为独立创作，已保留完整工程文件；有律师表示，“听着像”不等于法律意义上的抄袭，仍需专业鉴定。音乐平台暂未下架歌曲。\n\n（据公开报道改编）`,
  'ent-047': `2026 年 5 月，王某棣在综艺录制后凌晨发文，称“以为是我敏感了，当时确实不舒服”。这句话被网友称为“不舒服文学”，迅速登上热搜。\n\n随后，其父亲经营的炸串店出现大量差评。父亲回应称，店铺生意下降约 40%，白天晚上都受影响；他表示不反对儿子表达情绪，但希望讨论不要连累家人。\n\n（据公开报道改编）`,
  'ent-060': `2026 年 10 月，王某棣在上海举办个人演唱会。全场曲目均为翻唱，最高票价 2278 元，引发“没有代表作”“靠情怀割韭菜”的讨论。\n\n主办方称翻唱是本次演出的特别企划，已支付版权费用；部分观众认为舞台完成度高，也有观众要求公布曲目与退票规则。\n\n（据公开报道改编）`,
  'ent-061': `2026 年 11 月，首尔某品牌活动。现场视频显示，一名男高管在合影时靠近张某英行贴面礼，张某英明显侧身闪避，随后迅速回到队列。\n\n相关片段传播后，部分网友批评她“不专业”“不给面子”；也有大量声音认为她是在保持社交边界。张某英方面回应称，并非故意不打招呼，而是事发突然、本能躲闪。品牌方暂未公开说明活动流程。\n\n（据公开报道改编）`,
  'ent-075': `2026 年 9 月，时代**旗下男团在徐州举办演唱会。演出前后，部分粉丝为应援、进场和座位问题集中拨打当地 12345 热线。\n\n据公开报道，10 天内相关诉求接近 5 万件，夜班接线人员由 15 人临时增援，平台随后禁言多个组织账号。当地相关部门呼吁粉丝通过正常渠道反映问题。\n\n（据公开报道改编）`,
  'ent-077': `2026 年 10 月，虞某欣代言某老牌服装品牌。官宣首日，品牌全渠道销售额突破 6000 万元，相关战报迅速登上消费热搜。\n\n随后有声音质疑数据由粉丝冲量、退货率偏高，并翻出品牌此前的定价与售后“双标”争议。品牌称数据真实，虞某欣团队暂未回应。\n\n（据公开报道改编）`,
  'ent-089': `2026 年 10 月，赵某思全款投资并监制的短剧《Sonder·我不是 NPC》上线。预告片发布后，有网友指出部分镜头与《逐玉》相似，引发抄袭讨论。\n\n该剧上线后播放量约 5000 万，有演员在采访中称“观众认可才有工资拿”，短剧演员的薪酬模式随即成为讨论焦点。制作方暂未就预告争议给出完整说明。\n\n（据公开报道改编）`,
};

for (const card of CRISES) {
  if (CRISIS_DETAILS[card.id]) {
    card.detail = CRISIS_DETAILS[card.id];
  } else {
    card.detail = `2026 年，相关话题在社交平台持续发酵。公开信息主要涉及：${card.facts.join('；')}。\n\n事件发酵后，相关方陆续作出回应，但尚未给出完整说明。讨论集中在事件本身、当事人回应以及平台与主办方的处理方式。\n\n（综合公开报道）`;
  }
}

// Rebuild the deck from real Weibo hot-search topics.
const HOT_CRISES = require('./crisis-hot');
CRISES.splice(0, CRISES.length, ...HOT_CRISES);

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
    room.voteOrder = [];
    room.anonLabels = {};
    room.phaseEndsAt = null;
    room.startedAt = this.now();
    this.touch(room);
  }

  rerollCrisis(code, playerId, token) {
    const { room, player } = this.authenticate(code, playerId, token);
    if (room.hostId !== player.id) throw new GameError(403, '只有房主可以换危机卡。');
    if (room.phase !== 'writing') throw new GameError(409, '现在不是写提案阶段。');
    if (room.proposals.size > 0) throw new GameError(409, '已经有人提交提案，不能换卡。');

    let pool = CRISES.filter((item) => !room.usedCrises.includes(item.id));
    if (!pool.length) {
      room.usedCrises = [];
      pool = [...CRISES];
    }
    const next = shuffled(pool)[0];
    room.usedCrises.push(next.id);
    room.crisis = next;
    this.touch(room);
    return { room };
  }

  submitProposal(code, playerId, token, data) {
    const { room, player } = this.authenticate(code, playerId, token);
    if (room.phase !== 'writing') throw new GameError(409, '现在不是写提案的时间。');
    const text = cleanText(data?.text || data?.proposal, MAX_PROPOSAL);
    if (!text) throw new GameError(400, '先写一段提案。');
    room.proposals.set(player.id, { text });
    if (room.proposals.size >= room.players.length) {
      if (room.players.length === 2) this.reveal(room);
      else this.beginVoting(room);
    }
    this.touch(room);
    return { room };
  }

  beginVoting(room) {
    room.phase = 'voting';
    const order = shuffled(room.players);
    const labels = shuffled(ANON_LABELS).slice(0, order.length);
    room.voteOrder = order.map((player) => player.id);
    room.anonLabels = Object.fromEntries(order.map((player, index) => [player.id, labels[index]]));
    room.phaseEndsAt = null;
    this.touch(room);
  }

  finishWriting(room) {
    if (room.phase !== 'writing') return false;
    for (const player of room.players) {
      if (!room.proposals.has(player.id)) {
        room.proposals.set(player.id, {
          text: '（未提交）',
        });
      }
    }
    if (room.players.length === 2) this.reveal(room);
    else this.beginVoting(room);
    return true;
  }

  submitVote(code, playerId, token, targetId) {
    const { room, player } = this.authenticate(code, playerId, token);
    if (room.phase !== 'voting') throw new GameError(409, '现在不是投票时间。');
    if (room.players.length === 2) throw new GameError(409, '双人局不计分，提交后直接揭晓。');
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

  submitRating(code, playerId, token) {
    this.authenticate(code, playerId, token);
    throw new GameError(409, '双人局不计分，提交提案后直接揭晓。');
  }

  finishVoting(room) {
    if (room.phase !== 'voting') return false;
    this.reveal(room);
    return true;
  }

  reveal(room) {
    const isCoop = room.players.length === 2;
    const entries = room.players.map((player) => {
      const proposal = room.proposals.get(player.id) || {
        text: '（未提交）',
      };
      const votes = isCoop
        ? 0
        : [...room.votes.values()].filter((target) => target === player.id).length;
      return {
        playerId: player.id,
        name: player.name,
        color: player.color,
        proposal,
        votes,
        rating: null,
        points: isCoop ? 0 : votes,
      };
    });
    if (!isCoop) {
      for (const entry of entries) {
        room.scores.set(entry.playerId, (room.scores.get(entry.playerId) || 0) + entry.points);
      }
    }
    const result = {
      round: room.round,
      crisis: room.crisis,
      isCoop,
      ratingMode: false,
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
    room.voteOrder = [];
    room.anonLabels = {};
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
    const isCoop = room.players.length === 2;
    const ratingMode = false;
    const orderedPlayers = room.voteOrder?.length
      ? room.voteOrder.map((id) => room.players.find((player) => player.id === id)).filter(Boolean)
      : room.players;
    const proposals = room.proposals.size
      ? orderedPlayers.map((player, index) => {
          const proposal = room.proposals.get(player.id) || {
            text: '（未提交）',
          };
          return {
            id: player.id,
            label: revealing ? null : room.anonLabels?.[player.id] || '匿名作品',
            isYou: isPlayer && player.id === viewerId,
            author: revealing ? player.name : null,
            text: proposal.text,
            votes: revealing && !isCoop
              ? [...room.votes.values()].filter((target) => target === player.id).length
              : null,
            rating: null,
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
      isCoop,
      ratingMode,
      submittedCount: room.proposals.size,
      votedCount: room.votes.size,
      viewer: {
        id: viewer.id,
        name: viewer.name,
        isHost: isPlayer && viewer.id === room.hostId,
        isSpectator: !isPlayer,
        submitted: isPlayer && room.proposals.has(viewer.id),
        voted: isPlayer && room.votes.has(viewer.id),
      },
      scores: revealing && !isCoop
        ? room.players
            .map((player) => ({ id: player.id, name: player.name, score: room.scores.get(player.id) || 0 }))
            .sort((a, b) => b.score - a.score)
        : [],
      result: revealing ? room.history[room.history.length - 1] : null,
      history: room.history,
      canStart: isPlayer && room.phase === 'lobby' && viewer.id === room.hostId && room.players.length >= MIN_PLAYERS && room.players.length <= MAX_PLAYERS,
      canReroll: isPlayer && room.phase === 'writing' && viewer.id === room.hostId && room.proposals.size === 0,
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
    MAX_PROPOSAL,
  },
};
