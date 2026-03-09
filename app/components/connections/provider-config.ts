// @input: lucide-react icon components
// @output: providerIcons, providerColors, providerCapabilities, providerScopes, ConnectionProvider type
// @position: single source of truth for all provider-level display config

import {
  Bell,
  BookOpen,
  Camera,
  CreditCard,
  Disc3,
  HardDrive,
  Hash,
  Mail,
  MessageCircle,
  MessageSquare,
} from "lucide-react";
import type { UiConnectionProvider } from "@/lib/shared/connection-providers";

export type ConnectionProvider = UiConnectionProvider;

export const providerIcons: Record<ConnectionProvider, typeof Mail> = {
  gmail: Mail,
  "google-drive": HardDrive,
  slack: Hash,
  notion: BookOpen,
  feishu: MessageCircle,
  dingtalk: Bell,
  "wechat-work": MessageSquare,
  alipay: CreditCard,
  netease: Disc3,
  xiaohongshu: Camera,
};

export const providerColors: Record<ConnectionProvider, string> = {
  gmail: "bg-red-500/10 text-red-400",
  "google-drive": "bg-blue-500/10 text-blue-400",
  slack: "bg-purple-500/10 text-purple-400",
  notion: "bg-zinc-500/10 text-zinc-300",
  feishu: "bg-blue-500/10 text-blue-400",
  dingtalk: "bg-sky-500/10 text-sky-400",
  "wechat-work": "bg-green-500/10 text-green-400",
  alipay: "bg-blue-500/10 text-blue-400",
  netease: "bg-red-500/10 text-red-400",
  xiaohongshu: "bg-rose-500/10 text-rose-400",
};

export const providerCapabilities: Record<ConnectionProvider, string> = {
  gmail: "发送邮件、读取收件箱、管理标签",
  "google-drive": "上传下载文件、搜索文档",
  slack: "发送消息、读取频道、上传文件",
  notion: "创建页面、写入数据库、搜索笔记",
  feishu: "发送消息、创建文档、管理日历",
  dingtalk: "推送通知、发送工作消息",
  "wechat-work": "发消息、管理审批流",
  alipay: "处理支付、查询交易",
  netease: "扫码连接网易云账号、读取推荐、解锁更多可播曲目",
  xiaohongshu: "下载笔记视频图片、获取内容",
};

export const providerScopes: Record<ConnectionProvider, string[]> = {
  gmail: ["读取邮件", "发送邮件", "管理标签", "搜索邮件"],
  "google-drive": ["读取文件", "上传文件", "创建文件夹", "搜索文档"],
  slack: ["发送消息", "读取频道", "上传文件", "查看成员列表"],
  notion: ["读取页面", "创建页面", "写入数据库", "搜索工作区"],
  feishu: ["发送消息", "创建文档", "管理日历", "读取通讯录"],
  dingtalk: ["发送通知", "发送工作消息", "读取部门信息"],
  "wechat-work": ["发送消息", "管理审批流", "读取通讯录"],
  alipay: ["查询账户", "发起支付", "查询交易记录"],
  netease: ["扫码登录", "读取每日推荐", "解析更多可播链接"],
  xiaohongshu: ["读取主页内容", "下载笔记", "下载视频", "下载图片"],
};
