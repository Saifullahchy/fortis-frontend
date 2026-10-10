/**
 * Single import point for UI icons. Everything is Lineicons (free set).
 *
 * Icon data must come from the top-level @lineiconshq/free-icons (>= 1.0).
 * The React wrapper pins its own nested free-icons 0.0.1, whose exports are
 * plain components rather than the icon-data objects <Lineicons> renders.
 */
import { Lineicons, type LineiconsProps } from '@lineiconshq/react-lineicons'
import {
  Aeroplane1Outlined,
  AnchorOutlined,
  ArrowBothDirectionHorizontal1Outlined,
  ArrowLeftOutlined,
  Ban2Outlined,
  BeatOutlined,
  Bell1Outlined,
  Bolt2Outlined,
  Camera1Outlined,
  CameraMovie1Outlined,
  CheckOutlined,
  ChevronDownOutlined,
  ChevronRightOutlined,
  ChevronUpOutlined,
  EnterDownOutlined,
  ExitOutlined,
  ExpandArrow1Outlined,
  ExpandSquare4Outlined,
  GamePadModern1Outlined,
  Gauge1Outlined,
  Gear1Outlined,
  Globe1Outlined,
  HandStopOutlined,
  Home2Outlined,
  HourglassOutlined,
  Layers1Outlined,
  LocationArrowRightOutlined,
  MapMarker1Outlined,
  MapMarker5Outlined,
  MapPin5Outlined,
  MenuMeatballs1Outlined,
  MinusOutlined,
  Mountains2Outlined,
  PauseOutlined,
  PlayOutlined,
  PlusOutlined,
  RefreshCircle1ClockwiseOutlined,
  Route1Outlined,
  Search1Outlined,
  SelectCursor1Outlined,
  Shield2CheckOutlined,
  ShiftLeftOutlined,
  ShiftRightOutlined,
  SignalAppOutlined,
  SlidersHorizontalSquare2Outlined,
  TowerBroadcast1Outlined,
  Trash3Outlined,
  VectorNodes6Outlined,
  WaterDrop1Outlined,
  XmarkOutlined,
} from '@lineiconshq/free-icons'
import type { ComponentType } from 'react'

export interface IconProps {
  size?: number | string
  strokeWidth?: number
  className?: string
}

const STROKE = 1.5

function icon(data: LineiconsProps['icon'], name: string): ComponentType<IconProps> {
  const Icon = ({ size = 24, strokeWidth = STROKE, className }: IconProps) => (
    <Lineicons icon={data} size={size} strokeWidth={strokeWidth} className={className} />
  )
  Icon.displayName = name
  return Icon
}

// Names follow the semantic role used at the call sites, so pages read the
// same regardless of which Lineicons glyph backs them.
export const Activity = icon(BeatOutlined, 'Activity')
export const AlertTriangle = icon(Bell1Outlined, 'AlertTriangle')
export const Anchor = icon(AnchorOutlined, 'Anchor')
export const ArrowLeft = icon(ArrowLeftOutlined, 'ArrowLeft')
export const ArrowLeftRight = icon(ArrowBothDirectionHorizontal1Outlined, 'ArrowLeftRight')
export const Battery = icon(Bolt2Outlined, 'Battery')
export const Broadcast = icon(TowerBroadcast1Outlined, 'Broadcast')
export const Camera = icon(Camera1Outlined, 'Camera')
export const Check = icon(CheckOutlined, 'Check')
export const ChevronDown = icon(ChevronDownOutlined, 'ChevronDown')
export const ChevronRight = icon(ChevronRightOutlined, 'ChevronRight')
export const ChevronUp = icon(ChevronUpOutlined, 'ChevronUp')
export const CircleStop = icon(HandStopOutlined, 'CircleStop')
export const Compass = icon(Globe1Outlined, 'Compass')
export const Crosshair = icon(ExpandSquare4Outlined, 'Crosshair')
export const Gamepad2 = icon(GamePadModern1Outlined, 'Gamepad2')
export const Gauge = icon(Gauge1Outlined, 'Gauge')
export const GripHorizontal = icon(MenuMeatballs1Outlined, 'GripHorizontal')
export const History = icon(HourglassOutlined, 'History')
export const Home = icon(Home2Outlined, 'Home')
export const Layers3 = icon(Layers1Outlined, 'Layers3')
export const LocateFixed = icon(MapMarker5Outlined, 'LocateFixed')
export const LocateOff = icon(MapPin5Outlined, 'LocateOff')
export const MapPin = icon(MapMarker1Outlined, 'MapPin')
export const Maximize2 = icon(ExpandArrow1Outlined, 'Maximize2')
export const Minimize2 = icon(ExitOutlined, 'Minimize2')
export const Minus = icon(MinusOutlined, 'Minus')
export const Mountain = icon(Mountains2Outlined, 'Mountain')
export const MousePointer2 = icon(SelectCursor1Outlined, 'MousePointer2')
export const Navigation = icon(LocationArrowRightOutlined, 'Navigation')
export const Octagon = icon(Ban2Outlined, 'Octagon')
export const PanelLeftClose = icon(ShiftLeftOutlined, 'PanelLeftClose')
export const PanelLeftOpen = icon(ShiftRightOutlined, 'PanelLeftOpen')
export const Path = icon(Route1Outlined, 'Path')
export const Pause = icon(PauseOutlined, 'Pause')
export const Play = icon(PlayOutlined, 'Play')
export const PlaneLanding = icon(EnterDownOutlined, 'PlaneLanding')
export const PlaneTakeoff = icon(Aeroplane1Outlined, 'PlaneTakeoff')
export const Plus = icon(PlusOutlined, 'Plus')
export const Radio = icon(TowerBroadcast1Outlined, 'Radio')
export const RotateCcw = icon(RefreshCircle1ClockwiseOutlined, 'RotateCcw')
export const Route = icon(Route1Outlined, 'Route')
export const ScanLine = icon(VectorNodes6Outlined, 'ScanLine')
export const Search = icon(Search1Outlined, 'Search')
export const Settings2 = icon(Gear1Outlined, 'Settings2')
export const ShieldCheck = icon(Shield2CheckOutlined, 'ShieldCheck')
export const SlidersHorizontal = icon(SlidersHorizontalSquare2Outlined, 'SlidersHorizontal')
export const Target = icon(MapMarker5Outlined, 'Target')
export const Trash2 = icon(Trash3Outlined, 'Trash2')
export const Video = icon(CameraMovie1Outlined, 'Video')
export const Waves = icon(WaterDrop1Outlined, 'Waves')
export const Wifi = icon(SignalAppOutlined, 'Wifi')
export const X = icon(XmarkOutlined, 'X')
