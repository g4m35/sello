import type { CSSProperties } from "react";
import { Search, Plus, Minus, Check, X, ChevronRight, ChevronDown, ChevronUp, ListFilter, ArrowDownUp, Ellipsis, Pencil, Trash2, Upload, Download, ExternalLink, TriangleAlert, CircleAlert, Info, CircleCheck, CircleX, Clock, Package, PackageOpen, List, LayoutGrid, History, Settings, Store, Tag, Image, Send, RefreshCw, Play, Pause, Link, Copy, Bell, User, CircleHelp, Tags, Lock, Dot, ArrowUp, ArrowDown, ArrowRight, Sparkles, FileSpreadsheet, FileText, Flame, LogOut, Sun, Moon, Menu } from "lucide-react";

export type IconName =
  | "search" | "plus" | "minus" | "check" | "x" | "chevR" | "chevD" | "chevU"
  | "filter" | "sort" | "more" | "edit" | "trash" | "upload" | "download"
  | "external" | "warn" | "alert" | "info" | "check-c" | "x-c" | "clock"
  | "package" | "box" | "list" | "grid" | "history" | "settings" | "store"
  | "tag" | "image" | "send" | "refresh" | "play" | "pause" | "link" | "copy"
  | "bell" | "user" | "help" | "tags" | "lock" | "dot" | "arrow-up"
  | "arrow-dn" | "arrow-r" | "spark" | "csv" | "doc" | "flame" | "logout"
  | "sun" | "moon" | "menu";

type IconProps = {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
  style?: CSSProperties;
};

const icons = {
  "search": Search,
  "plus": Plus,
  "minus": Minus,
  "check": Check,
  "x": X,
  "chevR": ChevronRight,
  "chevD": ChevronDown,
  "chevU": ChevronUp,
  "filter": ListFilter,
  "sort": ArrowDownUp,
  "more": Ellipsis,
  "edit": Pencil,
  "trash": Trash2,
  "upload": Upload,
  "download": Download,
  "external": ExternalLink,
  "warn": TriangleAlert,
  "alert": CircleAlert,
  "info": Info,
  "check-c": CircleCheck,
  "x-c": CircleX,
  "clock": Clock,
  "package": Package,
  "box": PackageOpen,
  "list": List,
  "grid": LayoutGrid,
  "history": History,
  "settings": Settings,
  "store": Store,
  "tag": Tag,
  "image": Image,
  "send": Send,
  "refresh": RefreshCw,
  "play": Play,
  "pause": Pause,
  "link": Link,
  "copy": Copy,
  "bell": Bell,
  "user": User,
  "help": CircleHelp,
  "tags": Tags,
  "lock": Lock,
  "dot": Dot,
  "arrow-up": ArrowUp,
  "arrow-dn": ArrowDown,
  "arrow-r": ArrowRight,
  "spark": Sparkles,
  "csv": FileSpreadsheet,
  "doc": FileText,
  "flame": Flame,
  "logout": LogOut,
  "sun": Sun,
  "moon": Moon,
  "menu": Menu,
} as const;

export function Icon({ name, size = 16, strokeWidth = 1.7, className, style }: IconProps) {
  const Glyph = icons[name];
  return <Glyph size={size} strokeWidth={strokeWidth} className={className} style={{ flexShrink: 0, ...style }} aria-hidden="true" />;
}
