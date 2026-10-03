// SPDX-License-Identifier: MIT
#include "ui_shell.hpp"
#include "flat_button.hpp"
#include "vtk_canvas.hpp"
#include <wx/checkbox.h>
#include <wx/dialog.h>
#include <wx/listctrl.h>
#include <wx/sizer.h>
#include <wx/stattext.h>
#include <wx/textctrl.h>
#include <algorithm>
#include <set>

namespace {
wxString Text(const std::string& value) { return wxString::FromUTF8(value); }
std::string Name(const nlohmann::json& value, const char* key = "name") {
    const auto found = value.find(key);
    return found != value.end() && found->is_string() ? found->get<std::string>() : std::string();
}
void Theme(wxWindow* window) {
    window->SetBackgroundColour(wxColour(17, 31, 39));
    window->SetForegroundColour(wxColour(197, 212, 217));
    window->SetFont(wxFont(wxFontInfo(wxSize(0, 11)).FaceName("Segoe UI")));
}
wxBoxSizer* Begin(wxDialog& dialog, const wxString& subtitle) {
    Theme(&dialog);
    auto* layout = new wxBoxSizer(wxVERTICAL);
    auto* heading = new wxStaticText(&dialog, wxID_ANY, dialog.GetTitle());
    heading->SetFont(wxFont(wxFontInfo(wxSize(0, 20)).Bold().FaceName("Segoe UI")));
    layout->Add(heading, 0, wxALL, 18);
    auto* note = new wxStaticText(&dialog, wxID_ANY, subtitle);
    note->SetForegroundColour(wxColour(145, 166, 178));
    layout->Add(note, 0, wxLEFT | wxRIGHT | wxBOTTOM, 18);
    dialog.SetSizer(layout); return layout;
}
void End(wxDialog& dialog, wxBoxSizer* layout) {
    auto* close = new FlatButton(&dialog, "Close", wxSize(85, 32));
    close->Bind(wxEVT_BUTTON, [&dialog](wxCommandEvent&) { dialog.EndModal(wxID_OK); });
    layout->Add(close, 0, wxALIGN_RIGHT | wxALL, 14);
    dialog.Bind(wxEVT_CHAR_HOOK, [&dialog](wxKeyEvent& event) {
        if (event.GetKeyCode() == WXK_ESCAPE) dialog.EndModal(wxID_CANCEL); else event.Skip();
    });
    dialog.CentreOnParent(); dialog.ShowModal();
}
}

void UiShell::ShowLayerManager() {
    wxDialog dialog(this, wxID_ANY, "Layer manager", wxDefaultPosition, wxSize(850, 650), wxDEFAULT_DIALOG_STYLE | wxRESIZE_BORDER);
    auto* layout = Begin(dialog, "Visibility and physical layer stack");
    const auto& layers = viewport_->AvailableLayers();
    if (layers.empty()) layout->Add(new wxStaticText(&dialog, wxID_ANY, "Import a design to inspect its layers."), 1, wxALL, 18);
    else {
        for (const auto& layer : layers) {
            auto* checkbox = new wxCheckBox(&dialog, wxID_ANY, Text(layer)); Theme(checkbox);
            checkbox->SetValue(!layer_visibility_.contains(layer) || layer_visibility_[layer]);
            checkbox->Bind(wxEVT_CHECKBOX, [this, layer](wxCommandEvent& event) {
                layer_visibility_[layer] = event.IsChecked(); viewport_->SetLayerVisible(layer, event.IsChecked());
            });
            layout->Add(checkbox, 0, wxEXPAND | wxLEFT | wxRIGHT | wxBOTTOM, 12);
        }
        layout->AddStretchSpacer();
    }
    auto* translucency = new wxCheckBox(&dialog, wxID_ANY, "Translucent board view"); Theme(translucency);
    translucency->SetValue(translucent_);
    translucency->Bind(wxEVT_CHECKBOX, [this](wxCommandEvent& event) {
        translucent_ = event.IsChecked(); viewport_->SetTranslucent(translucent_);
    });
    layout->Add(translucency, 0, wxALL, 18); End(dialog, layout);
}

void UiShell::ShowNetManager() {
    wxDialog dialog(this, wxID_ANY, "Net manager", wxDefaultPosition, wxSize(1100, 700), wxDEFAULT_DIALOG_STYLE | wxRESIZE_BORDER);
    auto* layout = Begin(dialog, "Assign source, return, and series nets for power analysis");
    std::set<std::string> names;
    std::map<std::string, std::string> netIds;
    if (design_.is_object() && design_.contains("nets")) for (const auto& net : design_["nets"]) {
        const auto name = net.is_string() ? net.get<std::string>() : Name(net);
        if (!name.empty()) { names.insert(name); if (net.is_object()) netIds[Name(net, "id")] = name; }
    }
    for (const auto& collection : {"tracks", "pads", "vias", "zones"}) {
        if (!design_.is_object() || !design_.contains(collection) || !design_[collection].is_array()) continue;
        for (const auto& item : design_[collection]) if (const auto net = Name(item, "net"); !net.empty()) names.insert(net);
    }
    const std::vector<std::string> nets(names.begin(), names.end());
    std::vector<std::string> visible;
    auto* query = new wxTextCtrl(&dialog, wxID_ANY); Theme(query); query->SetHint("Search nets...");
    layout->Add(query, 0, wxEXPAND | wxLEFT | wxRIGHT | wxBOTTOM, 18);
    auto* table = new wxListCtrl(&dialog, wxID_ANY, wxDefaultPosition, wxDefaultSize, wxLC_REPORT | wxLC_SINGLE_SEL | wxBORDER_NONE); Theme(table);
    table->AppendColumn("NET", wxLIST_FORMAT_LEFT, 350); table->AppendColumn("ROLE", wxLIST_FORMAT_LEFT, 130);
    for (const auto& label : {"Tracks", "Pads", "Vias", "Zones"}) table->AppendColumn(label, wxLIST_FORMAT_RIGHT, 90);
    const auto populate = [&] {
        table->DeleteAllItems(); visible.clear();
        for (const auto& net : nets) {
            if (!Text(net).Lower().Contains(query->GetValue().Lower().Trim())) continue;
            const long row = table->InsertItem(table->GetItemCount(), Text(net)); visible.push_back(net);
            const auto role = std::find(managed_nets_.begin(), managed_nets_.end(), net);
            table->SetItem(row, 1, role == managed_nets_.end() ? "Unassigned" : role == managed_nets_.begin() ? "Source"
                : role == managed_nets_.begin() + 1 ? "Return" : "Series");
            int column = 2;
            for (const auto& collection : {"tracks", "pads", "vias", "zones"}) {
                unsigned count = 0;
                if (design_.is_object() && design_.contains(collection) && design_[collection].is_array())
                    for (const auto& item : design_[collection]) {
                        const auto id = Name(item, "net_id");
                        if (Name(item, "net") == net || (!id.empty() && netIds[id] == net)) ++count;
                    }
                table->SetItem(row, column++, wxString::Format("%u", count));
            }
        }
    };
    query->Bind(wxEVT_TEXT, [&](wxCommandEvent&) { populate(); }); layout->Add(table, 1, wxEXPAND | wxLEFT | wxRIGHT, 18);
    auto* actions = new wxBoxSizer(wxHORIZONTAL);
    for (const auto& role : {"Source", "Return", "Series", "Unassigned"}) {
        auto* button = new FlatButton(&dialog, role, wxSize(100, 34));
        button->Bind(wxEVT_BUTTON, [&, role](wxCommandEvent&) {
            const long row = table->GetNextItem(-1, wxLIST_NEXT_ALL, wxLIST_STATE_SELECTED);
            if (row < 0 || static_cast<std::size_t>(row) >= visible.size()) return;
            const auto net = visible[row];
            managed_nets_.erase(std::remove(managed_nets_.begin(), managed_nets_.end(), net), managed_nets_.end());
            const wxString value(role);
            if (value == "Source") managed_nets_.insert(managed_nets_.begin(), net);
            else if (value == "Return") managed_nets_.insert(managed_nets_.begin() + std::min<std::size_t>(1, managed_nets_.size()), net);
            else if (value == "Series") managed_nets_.push_back(net);
            MarkDirty(); status_->SetLabel("  " + Text(net) + " assigned as " + value.Lower()); populate();
        });
        actions->Add(button, 0, wxRIGHT, 8);
    }
    layout->Add(actions, 0, wxALL, 18); populate(); End(dialog, layout);
}

void UiShell::ShowStackup() {
    wxDialog dialog(this, wxID_ANY, "Stackup manager", wxDefaultPosition, wxSize(1000, 650), wxDEFAULT_DIALOG_STYLE | wxRESIZE_BORDER);
    auto* layout = Begin(dialog, "Physical layer data from the imported design");
    auto* table = new wxListCtrl(&dialog, wxID_ANY, wxDefaultPosition, wxDefaultSize, wxLC_REPORT | wxBORDER_NONE); Theme(table);
    for (const auto& column : {"Layer", "Type", "Thickness (mm)", "Z (mm)", "Material"}) table->AppendColumn(column, wxLIST_FORMAT_LEFT, 180);
    if (design_.is_object() && design_.contains("layers") && design_["layers"].is_array()) for (const auto& layer : design_["layers"]) {
        const long row = table->InsertItem(table->GetItemCount(), Text(Name(layer)));
        table->SetItem(row, 1, Text(Name(layer, "layer_type")));
        for (const auto& field : {std::pair{"thickness_mm", 2}, {"z_mm", 3}})
            if (layer.contains(field.first) && layer[field.first].is_number()) table->SetItem(row, field.second, wxString::Format("%.6g", layer[field.first].get<double>()));
        table->SetItem(row, 4, Text(Name(layer, "material_id")));
    }
    layout->Add(table, 1, wxEXPAND | wxLEFT | wxRIGHT, 18);
    layout->Add(new wxStaticText(&dialog, wxID_ANY, "Missing material or thickness values remain unspecified."), 0, wxALL, 18);
    End(dialog, layout);
}
