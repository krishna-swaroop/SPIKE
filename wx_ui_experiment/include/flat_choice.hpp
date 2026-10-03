// SPDX-License-Identifier: MIT
#pragma once
#include <wx/control.h>
#include <wx/arrstr.h>

class FlatChoice final : public wxControl {
public:
    FlatChoice(wxWindow* parent, const wxSize& size, const wxArrayString& choices);
    void SetSelection(int selection);
    int GetSelection() const { return selection_; }
    wxString GetStringSelection() const;
    unsigned GetCount() const { return choices_.size(); }
    wxString GetString(unsigned index) const { return choices_[index]; }
    int FindString(const wxString& value) const { return choices_.Index(value); }
private:
    void Open();
    void Choose(int selection);
    wxArrayString choices_;
    int selection_{0};
};
