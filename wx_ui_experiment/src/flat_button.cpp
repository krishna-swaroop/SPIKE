// SPDX-License-Identifier: MIT
#include "flat_button.hpp"
#include <wx/dcbuffer.h>

FlatButton::FlatButton(wxWindow* parent, const wxString& label,
                       const wxSize& size, const wxBitmap& icon)
    : wxControl(parent, wxID_ANY, wxDefaultPosition, size, wxBORDER_NONE | wxWANTS_CHARS), icon_(icon) {
    SetLabel(label); SetName(label); SetMinSize(size);
    SetBackgroundStyle(wxBG_STYLE_PAINT);
    SetFont(wxFont(wxFontInfo(wxSize(0, 10)).FaceName("Segoe UI")));
    Bind(wxEVT_PAINT, [this](wxPaintEvent&) {
        wxAutoBufferedPaintDC dc(this);
        const wxColour foreground = !IsEnabled() ? wxColour(80, 98, 109)
            : accent_ || active_ ? wxColour(15, 32, 40) : wxColour(169, 186, 195);
        const wxColour background = accent_ ? wxColour(219, 162, 58)
            : active_ ? wxColour(89, 200, 202)
            : hovered_ ? wxColour(38, 59, 72) : wxColour(25, 41, 50);
        dc.SetBackground(wxBrush(background)); dc.Clear();
        dc.SetPen(wxPen(HasFocus() ? wxColour(240, 179, 75) : wxColour(51, 74, 84)));
        dc.SetBrush(*wxTRANSPARENT_BRUSH); dc.DrawRectangle(GetClientRect());
        dc.SetFont(GetFont()); dc.SetTextForeground(foreground);
        const auto text = dc.GetTextExtent(GetLabel());
        const int iconWidth = icon_.IsOk() ? icon_.GetWidth() + 7 : 0;
        const int x = (GetClientSize().x - text.x - iconWidth) / 2;
        if (icon_.IsOk()) dc.DrawBitmap(icon_, x, (GetClientSize().y - icon_.GetHeight()) / 2, true);
        dc.DrawText(GetLabel(), x + iconWidth, (GetClientSize().y - text.y) / 2);
    });
    Bind(wxEVT_ENTER_WINDOW, [this](wxMouseEvent&) { hovered_ = true; Refresh(); });
    Bind(wxEVT_LEAVE_WINDOW, [this](wxMouseEvent&) { hovered_ = false; Refresh(); });
    Bind(wxEVT_LEFT_UP, [this](wxMouseEvent& event) {
        if (GetClientRect().Contains(event.GetPosition())) { SetFocus(); Activate(); }
    });
    Bind(wxEVT_KEY_DOWN, [this](wxKeyEvent& event) {
        if (event.GetKeyCode() == WXK_RETURN || event.GetKeyCode() == WXK_SPACE) Activate();
        else event.Skip();
    });
    Bind(wxEVT_SET_FOCUS, [this](wxFocusEvent& event) { Refresh(); event.Skip(); });
    Bind(wxEVT_KILL_FOCUS, [this](wxFocusEvent& event) { Refresh(); event.Skip(); });
}
void FlatButton::SetActive(bool active) { active_ = active; Refresh(); }
void FlatButton::SetAccent(bool accent) { accent_ = accent; Refresh(); }
void FlatButton::Activate() {
    if (!IsEnabled()) return;
    wxCommandEvent event(wxEVT_BUTTON, GetId()); event.SetEventObject(this);
    ProcessWindowEvent(event);
}
