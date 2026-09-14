// cdh-winid.swift - dev only. Prints "<windowId> <width> <height>" for the game's large layer-0 windows, so a
// screenshot can grab the game even when another window is in front: screencapture -x -o -l <windowId> out.png
// Run: swift devtools/harness/cdh-winid.swift
import CoreGraphics
let list = CGWindowListCopyWindowInfo(.optionAll, kCGNullWindowID) as! [[String: Any]]
for w in list {
  let owner = w[kCGWindowOwnerName as String] as? String ?? ""
  if owner.contains("ivilization") {
    let b = w[kCGWindowBounds as String] as? [String: Any] ?? [:]
    let wd = b["Width"] as? Double ?? 0
    let ht = b["Height"] as? Double ?? 0
    let layer = w[kCGWindowLayer as String] as? Int ?? -1
    if wd > 400 && layer == 0 { print(w[kCGWindowNumber as String] as? Int ?? 0, Int(wd), Int(ht)) }
  }
}
