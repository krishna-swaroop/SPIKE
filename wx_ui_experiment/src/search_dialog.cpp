// SPDX-License-Identifier: MIT
#include "search_dialog.hpp"

#include <wx/button.h>
#include <wx/dialog.h>
#include <wx/listbox.h>
#include <wx/sizer.h>
#include <wx/stattext.h>
#include <wx/textctrl.h>

#include <utility>
#include <vector>

namespace {
struct Command {
    wxString label;
    wxString category;
    wxString action;
};

wxString StringField(const nlohmann::json& value, const char* key) {
    return value.is_object() && value.contains(key) && value[key].is_string()
        ? wxString::FromUTF8(value[key].get<std::string>()) : wxString();
}

class SearchDialog final : public wxDialog {
public:
    SearchDialog(wxWindow* parent, const nlohmann::json& manifest,
                 std::function<void(const wxString&)> dispatch)
        : wxDialog(parent, wxID_ANY, "Search commands", wxDefaultPosition, wxSize(760, 680),
                   wxDEFAULT_DIALOG_STYLE | wxRESIZE_BORDER), dispatch_(std::move(dispatch)) {
        SetBackgroundColour(wxColour(17, 29, 36));
        SetForegroundColour(wxColour(217, 226, 234));
        for (const auto& tab : manifest.value("tabs", nlohmann::json::array())) {
            const auto tabName = StringField(tab, "tab");
            commands_.push_back({tabName + " workspace", "Workspace", "Tab:" + tabName});
            for (const auto& group : tab.value("groups", nlohmann::json::array())) {
                for (const auto& tool : group.value("tools", nlohmann::json::array())) {
                    const auto label = StringField(tool, "label");
                    const auto id = StringField(tool, "id");
                    if (!label.empty()) commands_.push_back({label, tabName, id.empty() ? label : "Command:" + id});
                }
            }
        }
        for (const auto& menu : manifest.value("menus", nlohmann::json::array())) {
            const auto category = StringField(menu, "label");
            for (const auto& item : menu.value("items", nlohmann::json::array())) {
                const auto label = StringField(item, "label");
                const auto id = StringField(item, "id");
                if (!label.empty()) commands_.push_back({label, category, id.empty() ? label : "Command:" + id});
            }
        }

        auto* layout = new wxBoxSizer(wxVERTICAL);
        auto* heading = new wxStaticText(this, wxID_ANY, "SEARCH COMMANDS, SETTINGS, AND WORKSPACES");
        heading->SetForegroundColour(wxColour(111, 209, 207));
        layout->Add(heading, 0, wxLEFT | wxRIGHT | wxTOP | wxBOTTOM, 13);
        query_ = new wxTextCtrl(this, wxID_ANY, {}, wxDefaultPosition, wxSize(-1, 42),
                                wxTE_PROCESS_ENTER | wxBORDER_SIMPLE);
        query_->SetHint("Search commands, settings, workspaces...");
        query_->SetBackgroundColour(wxColour(23, 40, 50));
        query_->SetForegroundColour(wxColour(226, 236, 239));
        layout->Add(query_, 0, wxEXPAND | wxLEFT | wxRIGHT | wxBOTTOM, 13);
        results_ = new wxListBox(this, wxID_ANY, wxDefaultPosition, wxDefaultSize, {},
                                 wxLB_SINGLE | wxBORDER_SIMPLE);
        results_->SetBackgroundColour(wxColour(17, 29, 36));
        results_->SetForegroundColour(wxColour(185, 203, 209));
        layout->Add(results_, 1, wxEXPAND | wxLEFT | wxRIGHT, 13);
        auto* hint = new wxStaticText(this, wxID_ANY, "Enter: open command     Esc: close");
        hint->SetForegroundColour(wxColour(110, 133, 143));
        layout->Add(hint, 0, wxALIGN_RIGHT | wxALL, 13);
        SetSizer(layout);

        query_->Bind(wxEVT_TEXT, [this](wxCommandEvent&) { RefreshResults(); });
        query_->Bind(wxEVT_TEXT_ENTER, [this](wxCommandEvent&) { ActivateSelection(); });
        results_->Bind(wxEVT_LISTBOX_DCLICK, [this](wxCommandEvent&) { ActivateSelection(); });
        results_->Bind(wxEVT_CHAR_HOOK, [this](wxKeyEvent& event) {
            if (event.GetKeyCode() == WXK_RETURN) ActivateSelection();
            else event.Skip();
        });
        RefreshResults();
        CentreOnParent();
        query_->SetFocus();
    }

private:
    void RefreshResults() {
        visible_.clear();
        results_->Clear();
        const auto needle = query_->GetValue().Lower().Trim();
        for (std::size_t index = 0; index < commands_.size(); ++index) {
            const auto& command = commands_[index];
            if (!needle.empty() && !command.label.Lower().Contains(needle) &&
                !command.category.Lower().Contains(needle)) continue;
            visible_.push_back(index);
            results_->Append(command.label + "    |    " + command.category);
            if (visible_.size() >= 150) break;
        }
        if (!visible_.empty()) results_->SetSelection(0);
    }

    void ActivateSelection() {
        const int selected = results_->GetSelection();
        if (selected == wxNOT_FOUND || static_cast<std::size_t>(selected) >= visible_.size()) return;
        const auto action = commands_[visible_[selected]].action;
        EndModal(wxID_OK);
        dispatch_(action);
    }

    std::function<void(const wxString&)> dispatch_;
    std::vector<Command> commands_;
    std::vector<std::size_t> visible_;
    wxTextCtrl* query_{nullptr};
    wxListBox* results_{nullptr};
};
}  // namespace

void ShowSearchDialog(wxWindow* parent, const nlohmann::json& manifest,
                      const std::function<void(const wxString&)>& dispatch) {
    SearchDialog dialog(parent, manifest, dispatch);
    dialog.ShowModal();
}
