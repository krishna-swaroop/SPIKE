// SPDX-License-Identifier: MIT
#pragma once
#include <wx/control.h>
#include <wx/bitmap.h>

// Flat Tauri-style control with the native button event and keyboard behavior.
class FlatButton final : public wxControl {
public:
    FlatButton(wxWindow* parent, const wxString& label, const wxSize& size,
               const wxBitmap& icon = {});
    void SetActive(bool active);
    void SetAccent(bool accent);
private:
    void Activate();
    wxBitmap icon_;
    bool active_{false}, accent_{false}, hovered_{false};
};
