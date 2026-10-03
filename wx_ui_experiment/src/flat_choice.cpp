// SPDX-License-Identifier: MIT
#include "flat_choice.hpp"
#include <wx/dcbuffer.h>
#include <wx/popupwin.h>
#include <wx/weakref.h>
#include <algorithm>
#include <functional>

namespace {
class Choices final : public wxPopupTransientWindow {
public:
    Choices(wxWindow* parent, wxArrayString values, int selected, std::function<void(int)> choose)
        : wxPopupTransientWindow(parent, wxBORDER_NONE), values_(std::move(values)), selected_(selected), choose_(std::move(choose)) {
        SetBackgroundStyle(wxBG_STYLE_PAINT);
        SetSize(parent->GetSize().x, static_cast<int>(values_.size()) * 30 + 2);
        SetFont(parent->GetFont());
        Bind(wxEVT_PAINT, [this](wxPaintEvent&) {
            wxAutoBufferedPaintDC dc(this); dc.SetBackground(wxBrush(wxColour(15, 26, 33))); dc.Clear();
            dc.SetFont(GetFont());
            for (unsigned i = 0; i < values_.size(); ++i) {
                dc.SetPen(*wxTRANSPARENT_PEN);
                dc.SetBrush(wxBrush(i == static_cast<unsigned>(selected_) ? wxColour(38, 60, 70) : wxColour(15, 26, 33)));
                dc.DrawRectangle(1, static_cast<int>(i) * 30 + 1, GetClientSize().x - 2, 30);
                dc.SetTextForeground(wxColour(217, 226, 234)); dc.DrawText(values_[i], 10, static_cast<int>(i) * 30 + 9);
            }
            dc.SetPen(wxPen(wxColour(82, 105, 116))); dc.SetBrush(*wxTRANSPARENT_BRUSH); dc.DrawRectangle(GetClientRect());
        });
        Bind(wxEVT_MOTION, [this](wxMouseEvent& event) { selected_ = std::clamp(event.GetY() / 30, 0, static_cast<int>(values_.size()) - 1); Refresh(); });
        Bind(wxEVT_LEFT_DOWN, [this](wxMouseEvent& event) {
            const int index = event.GetY() / 30;
            if (index < 0 || static_cast<unsigned>(index) >= values_.size()) return;
            const auto choose = choose_; Dismiss(); choose(index);
        });
    }
    void OnDismiss() override { CallAfter([this] { Destroy(); }); }
private:
    wxArrayString values_;
    int selected_;
    std::function<void(int)> choose_;
};
}

FlatChoice::FlatChoice(wxWindow* parent, const wxSize& size, const wxArrayString& choices)
    : wxControl(parent, wxID_ANY, wxDefaultPosition, size, wxBORDER_NONE | wxWANTS_CHARS), choices_(choices) {
    SetMinSize(wxSize(size.x, size.y < 0 ? 31 : size.y));
    SetBackgroundStyle(wxBG_STYLE_PAINT);
    SetFont(wxFont(wxFontInfo(wxSize(0, 10)).FaceName("Segoe UI")));
    Bind(wxEVT_PAINT, [this](wxPaintEvent&) {
        wxAutoBufferedPaintDC dc(this); dc.SetBackground(wxBrush(wxColour(15, 26, 33))); dc.Clear();
        dc.SetPen(wxPen(HasFocus() ? wxColour(240, 179, 75) : wxColour(53, 74, 84)));
        dc.SetBrush(*wxTRANSPARENT_BRUSH); dc.DrawRectangle(GetClientRect());
        dc.SetFont(GetFont()); dc.SetTextForeground(IsEnabled() ? wxColour(217, 226, 234) : wxColour(80, 98, 109));
        const auto text = GetStringSelection();
        dc.DrawText(text, 10, (GetClientSize().y - dc.GetTextExtent(text).y) / 2);
        const int x = GetClientSize().x - 15, y = GetClientSize().y / 2;
        dc.SetPen(wxPen(wxColour(145, 166, 178))); dc.DrawLine(x - 4, y - 2, x, y + 2); dc.DrawLine(x, y + 2, x + 4, y - 2);
    });
    Bind(wxEVT_LEFT_UP, [this](wxMouseEvent&) { SetFocus(); Open(); });
    Bind(wxEVT_KEY_DOWN, [this](wxKeyEvent& event) {
        if (event.GetKeyCode() == WXK_RETURN || event.GetKeyCode() == WXK_SPACE) Open();
        else if (event.GetKeyCode() == WXK_UP || event.GetKeyCode() == WXK_DOWN)
            Choose(std::clamp(selection_ + (event.GetKeyCode() == WXK_UP ? -1 : 1), 0, static_cast<int>(choices_.size()) - 1));
        else event.Skip();
    });
    Bind(wxEVT_SET_FOCUS, [this](wxFocusEvent& event) { Refresh(); event.Skip(); });
    Bind(wxEVT_KILL_FOCUS, [this](wxFocusEvent& event) { Refresh(); event.Skip(); });
}
wxString FlatChoice::GetStringSelection() const { return selection_ >= 0 && static_cast<unsigned>(selection_) < choices_.size() ? choices_[selection_] : wxString(); }
void FlatChoice::SetSelection(int selection) { selection_ = selection; SetLabel(GetStringSelection()); Refresh(); }
void FlatChoice::Choose(int selection) {
    if (!IsEnabled()) return;
    SetSelection(selection); wxCommandEvent event(wxEVT_CHOICE, GetId()); event.SetInt(selection_); event.SetEventObject(this); ProcessWindowEvent(event);
}
void FlatChoice::Open() {
    if (!IsEnabled() || choices_.empty()) return;
    wxWeakRef<FlatChoice> self(this);
    auto* popup = new Choices(this, choices_, selection_, [self](int selection) { if (self) self->Choose(selection); });
    popup->Position(ClientToScreen(wxPoint(0, GetClientSize().y)), wxSize(0, 0)); popup->Popup();
}
