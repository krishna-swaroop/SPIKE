// SPDX-License-Identifier: MIT
#include "ui_shell.hpp"
#include "search_dialog.hpp"
#include "flat_button.hpp"
#include "flat_choice.hpp"
#include "vtk_canvas.hpp"

#include <wx/bmpbndl.h>
#include <wx/dcbuffer.h>
#include <wx/button.h>
#include <wx/dialog.h>
#include <wx/filedlg.h>
#include <wx/filename.h>
#include <wx/listctrl.h>
#include <wx/msgdlg.h>
#include <wx/notebook.h>
#include <wx/simplebook.h>
#include <wx/choice.h>
#include <wx/panel.h>
#include <wx/popupwin.h>
#include <wx/sizer.h>
#include <wx/splitter.h>
#include <wx/stattext.h>
#include <wx/textctrl.h>
#include <wx/treectrl.h>

#include <algorithm>
#include <fstream>
#include <functional>
#include <map>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
const wxColour kShell(16, 24, 32), kTop(23, 35, 44), kMenu(20, 32, 41);
const wxColour kRibbon(27, 42, 52), kPanel(20, 32, 41), kCanvas(12, 21, 27);
const wxColour kBorder(43, 59, 70), kText(217, 226, 234), kMuted(145, 166, 178);
const wxColour kGold(240, 179, 75), kCyan(89, 200, 202);

wxString Utf8(const std::string& value) { return wxString::FromUTF8(value); }

wxString Field(const nlohmann::json& value, const char* key) {
    return value.is_object() && value.contains(key) && value[key].is_string()
        ? Utf8(value[key].get<std::string>()) : wxString();
}

wxFont Font(int size, bool bold = false) {
    wxFont font(wxFontInfo(wxSize(0, size)).FaceName("Segoe UI"));
    if (bold) font.MakeBold();
    return font;
}

void Fill(wxDC& dc, const wxRect& rect, const wxColour& colour) {
    dc.SetPen(wxPen(colour)); dc.SetBrush(wxBrush(colour)); dc.DrawRectangle(rect);
}

class IconCache {
public:
    explicit IconCache(std::filesystem::path root) : root_(std::move(root)) {}
    wxBitmap Get(const wxString& icon, const wxColour& colour, int size) {
        const std::string key = icon.ToStdString() + colour.GetAsString(wxC2S_HTML_SYNTAX).ToStdString() + std::to_string(size);
        if (const auto found = cache_.find(key); found != cache_.end()) return found->second;
        const auto path = root_ / "icons" / (icon.ToStdString() + ".svg");
        std::ifstream input(path, std::ios::binary);
        if (!input) return {};
        std::string svg((std::istreambuf_iterator<char>(input)), std::istreambuf_iterator<char>());
        const std::string target = colour.GetAsString(wxC2S_HTML_SYNTAX).ToStdString();
        std::size_t pos = 0;
        while ((pos = svg.find("#a9bac3", pos)) != std::string::npos) {
            svg.replace(pos, 7, target); pos += target.size();
        }
        const auto bundle = wxBitmapBundle::FromSVG(svg.c_str(), wxSize(size, size));
        auto bitmap = bundle.GetBitmap(wxSize(size, size));
        cache_.emplace(key, bitmap);
        return bitmap;
    }
private:
    std::filesystem::path root_;
    std::map<std::string, wxBitmap> cache_;
};

class MenuPopup final : public wxPopupTransientWindow {
public:
    MenuPopup(wxWindow* parent, const nlohmann::json& items, IconCache& icons,
              std::function<void(const wxString&)> dispatch)
        : wxPopupTransientWindow(parent, wxBORDER_NONE), items_(items), icons_(icons), dispatch_(std::move(dispatch)) {
        SetBackgroundStyle(wxBG_STYLE_PAINT);
        SetSize(230, static_cast<int>(items_.size()) * 29 + 10);
        Bind(wxEVT_PAINT, &MenuPopup::OnPaint, this);
        Bind(wxEVT_LEFT_DOWN, &MenuPopup::OnClick, this);
        Bind(wxEVT_MOTION, [this](wxMouseEvent& event) {
            hovered_ = (event.GetY() - 5) / 29; Refresh();
        });
    }
private:
    void OnDismiss() override { CallAfter([this] { Destroy(); }); }
    void OnPaint(wxPaintEvent&) {
        wxAutoBufferedPaintDC dc(this);
        Fill(dc, GetClientRect(), wxColour(23, 38, 47));
        dc.SetPen(wxPen(wxColour(82, 105, 116))); dc.SetBrush(*wxTRANSPARENT_BRUSH);
        dc.DrawRectangle(GetClientRect());
        for (std::size_t index = 0; index < items_.size(); ++index) {
            const int y = 5 + static_cast<int>(index) * 29;
            if (static_cast<int>(index) == hovered_) Fill(dc, wxRect(5, y, 220, 28), wxColour(38, 60, 70));
            const auto& item = items_[index];
            const auto bitmap = icons_.Get(Field(item, "icon"), kMuted, 14);
            if (bitmap.IsOk()) dc.DrawBitmap(bitmap, 14, y + 7, true);
            dc.SetFont(Font(10)); dc.SetTextForeground(static_cast<int>(index) == hovered_ ? kGold : wxColour(197, 212, 217));
            dc.DrawText(Field(item, "label"), 39, y + 7);
            const auto shortcut = Field(item, "shortcut");
            if (!shortcut.empty()) {
                dc.SetFont(Font(9)); dc.SetTextForeground(wxColour(113, 137, 146));
                dc.DrawText(shortcut, 221 - dc.GetTextExtent(shortcut).x, y + 8);
            }
        }
    }
    void OnClick(wxMouseEvent& event) {
        const int index = (event.GetY() - 5) / 29;
        if (index < 0 || index >= static_cast<int>(items_.size())) return;
        const auto id = Field(items_[index], "id");
        const auto label = Field(items_[index], "label");
        auto dispatch = dispatch_;
        Dismiss(); dispatch(id.empty() ? label : "Command:" + id);
    }
    const nlohmann::json& items_;
    IconCache& icons_;
    std::function<void(const wxString&)> dispatch_;
    int hovered_{-1};
};

class ChromePanel final : public wxPanel {
public:
    ChromePanel(wxWindow* parent, const nlohmann::json& manifest, const std::filesystem::path& assets,
                std::function<void(const wxString&)> dispatch)
        : wxPanel(parent), manifest_(manifest), assets_(assets), icons_(assets), dispatch_(std::move(dispatch)) {
        SetBackgroundStyle(wxBG_STYLE_PAINT);
        SetMinSize(wxSize(-1, 202));
        std::ifstream input(assets_ / "spike-mark.svg", std::ios::binary);
        if (input) {
            const std::string svg((std::istreambuf_iterator<char>(input)), std::istreambuf_iterator<char>());
            logo_ = wxBitmapBundle::FromSVG(svg.c_str(), wxSize(29, 29)).GetBitmap(wxSize(29, 29));
        }
        Bind(wxEVT_PAINT, &ChromePanel::OnPaint, this);
        Bind(wxEVT_LEFT_DOWN, &ChromePanel::OnClick, this);
        Bind(wxEVT_MOTION, [this](wxMouseEvent& event) {
            wxString hovered;
            for (auto it = hits_.rbegin(); it != hits_.rend(); ++it)
                if (it->rect.Contains(event.GetPosition())) { hovered = it->action; break; }
            if (hovered != hovered_) {
                hovered_ = hovered;
                wxString tooltip = hovered;
                if (hovered.StartsWith("Command:")) {
                    for (const auto& tab : manifest_["tabs"]) for (const auto& group : tab["groups"])
                        for (const auto& tool : group["tools"])
                            if (hovered == "Command:" + Field(tool, "id")) tooltip = Field(tool, "label");
                }
                SetToolTip(tooltip); Refresh();
            }
        });
        Bind(wxEVT_LEAVE_WINDOW, [this](wxMouseEvent&) { hovered_.clear(); Refresh(); });
        Bind(wxEVT_MOUSEWHEEL, [this](wxMouseEvent& event) {
            if (event.GetY() >= 80 && event.GetY() < 120) {
                tab_scroll_ = std::clamp(tab_scroll_ - event.GetWheelRotation() / 2, 0, tab_max_);
                Refresh();
            } else if (event.GetY() >= 120) {
                tool_scroll_ = std::clamp(tool_scroll_ - event.GetWheelRotation() / 2, 0, tool_max_);
                Refresh();
            } else event.Skip();
        });
    }
    void SetTab(const wxString& tab) { tab_ = tab; tool_scroll_ = 0; Refresh(); }
    void SetProject(const wxString& name) { project_ = name; Refresh(); }
    void SetViewMode(const wxString& mode) { view_mode_ = mode; Refresh(); }
    void SetDesignLoaded(bool loaded) { design_loaded_ = loaded; Refresh(); }
    void SetWorkerState(bool ready, bool busy) {
        if (worker_ready_ == ready && worker_busy_ == busy) return;
        worker_ready_ = ready; worker_busy_ = busy; Refresh();
    }
    void SetRibbonVisible(bool visible) {
        visible_ = visible; SetMinSize(wxSize(-1, visible ? 202 : 120));
        SetMaxSize(wxSize(-1, visible ? 202 : 120)); Refresh();
    }
private:
    struct Hit { wxRect rect; wxString action; };
    void AddHit(const wxRect& rect, const wxString& action) { hits_.push_back({rect, action}); }
    void Icon(wxDC& dc, const wxString& name, const wxColour& colour, int x, int y, int size) {
        const auto bitmap = icons_.Get(name, colour, size);
        if (bitmap.IsOk()) dc.DrawBitmap(bitmap, x, y, true);
    }
    void OnPaint(wxPaintEvent&) {
        wxAutoBufferedPaintDC dc(this);
        const int width = GetClientSize().x;
        hits_.clear();
        Fill(dc, wxRect(0, 0, width, 52), kTop);
        Fill(dc, wxRect(0, 52, width, 28), kMenu);
        Fill(dc, wxRect(0, 80, width, 40), kTop);
        if (visible_) Fill(dc, wxRect(0, 120, width, 82), kRibbon);
        dc.SetPen(wxPen(kBorder));
        for (const int y : {51, 79, 119, visible_ ? 201 : 119}) dc.DrawLine(0, y, width, y);

        if (logo_.IsOk()) dc.DrawBitmap(logo_, 18, 11, true);
        dc.SetFont(Font(15, true)); dc.SetTextForeground(wxColour(241, 246, 248)); dc.DrawText("SPIKE", 57, 9);
        dc.SetFont(Font(8)); dc.SetTextForeground(wxColour(120, 144, 157));
        dc.DrawText("ELECTRONIC SYSTEMS INTEGRITY WORKBENCH", 57, 30);
        dc.SetFont(Font(10)); dc.SetTextForeground(wxColour(127, 150, 164)); dc.DrawText("Project", 315, 19);
        dc.SetTextForeground(kText); dc.DrawText(project_, 367, 19);
        const int chevronX = 367 + dc.GetTextExtent(project_).x + 9;
        dc.SetPen(wxPen(kMuted));
        dc.DrawLine(chevronX, 22, chevronX + 5, 27);
        dc.DrawLine(chevronX + 5, 27, chevronX + 10, 22);
        AddHit(wxRect(306, 0, 250, 52), "Project manager");
        const int searchX = std::max(570, width - 315);
        Fill(dc, wxRect(searchX, 11, 170, 30), wxColour(17, 29, 36));
        dc.SetPen(wxPen(wxColour(53, 74, 84))); dc.SetBrush(*wxTRANSPARENT_BRUSH);
        dc.DrawRectangle(searchX, 11, 170, 30);
        Icon(dc, "Search", kMuted, searchX + 7, 18, 15);
        dc.SetFont(Font(10)); dc.SetTextForeground(kMuted); dc.DrawText("Search", searchX + 27, 19);
        dc.SetPen(wxPen(wxColour(64, 84, 94))); dc.SetBrush(wxBrush(wxColour(21, 37, 45)));
        dc.DrawRectangle(searchX + 133, 17, 30, 17);
        dc.SetFont(Font(8)); dc.SetTextForeground(wxColour(113, 136, 146)); dc.DrawText("Ctrl K", searchX + 136, 20);
        AddHit(wxRect(searchX, 11, 170, 30), "Search");
        Icon(dc, "Bell", kMuted, width - 112, 18, 17);
        Icon(dc, "CircleHelp", kMuted, width - 72, 18, 17);
        dc.SetPen(wxPen(kGold)); dc.SetBrush(wxBrush(kGold));
        dc.DrawCircle(width - 27, 25, 13);
        dc.SetTextForeground(wxColour(19, 32, 40)); dc.SetFont(Font(9, true)); dc.DrawText("USR", width - 37, 19);
        AddHit(wxRect(width - 119, 9, 26, 33), "Notifications");
        AddHit(wxRect(width - 79, 9, 26, 33), "Help and user guide");
        AddHit(wxRect(width - 43, 9, 30, 33), "Settings");

        int menuX = 14;
        for (const auto& menu : manifest_.value("menus", nlohmann::json::array())) {
            const auto label = Field(menu, "label");
            dc.SetFont(Font(10)); dc.SetTextForeground(wxColour(157, 176, 183));
            const auto span = dc.GetTextExtent(label).x + 20;
            dc.DrawText(label, menuX + 10, 59);
            AddHit(wxRect(menuX, 52, span, 28), "Menu:" + label);
            menuX += span + 2;
        }

        int tabX = 16 - tab_scroll_;
        for (const auto& tab : manifest_.value("tabs", nlohmann::json::array())) {
            const auto label = Field(tab, "tab");
            dc.SetFont(Font(12));
            const int span = dc.GetTextExtent(label).x + 53;
            if (tabX + span > 0 && tabX < width) {
                if (label == tab_) {
                    Fill(dc, wxRect(tabX, 81, span, 39), wxColour(28, 43, 53));
                    Fill(dc, wxRect(tabX, 118, span, 2), kGold);
                }
                const auto colour = label == tab_ ? wxColour(245, 195, 107) : kMuted;
                Icon(dc, Field(tab, "icon"), colour, tabX + 15, 92, 16);
                dc.SetTextForeground(colour); dc.DrawText(label, tabX + 38, 92);
                AddHit(wxRect(tabX, 80, span, 40), "Tab:" + label);
            }
            tabX += span + 3;
        }
        tab_max_ = std::max(0, tabX + tab_scroll_ - width + 106);
        Fill(dc, wxRect(width - 96, 81, 96, 38), kTop);
        Icon(dc, "PanelTop", kMuted, width - 101, 92, 15);
        dc.SetFont(Font(10)); dc.SetTextForeground(kMuted);
        dc.DrawText(visible_ ? "Minimize" : "Expand", width - 76, 92);
        AddHit(wxRect(width - 96, 80, 96, 40), "Toggle ribbon");
        if (!visible_) return;

        int x = 17 - tool_scroll_;
        dc.SetFont(Font(9, true)); dc.SetTextForeground(wxColour(119, 145, 157));
        dc.DrawText("BOARD VIEW", x, 128);
        x += 1;
        for (const auto& item : manifest_.value("boardView", nlohmann::json::array())) {
            const auto label = Field(item, "label");
            const bool active = label == view_mode_;
            Fill(dc, wxRect(x, 151, 31, 31), active ? kCyan : wxColour(20, 33, 41));
            dc.SetPen(wxPen(wxColour(52, 74, 84))); dc.SetBrush(*wxTRANSPARENT_BRUSH);
            dc.DrawRectangle(x, 151, 31, 31);
            Icon(dc, Field(item, "icon"), active ? wxColour(9, 32, 39) : kMuted, x + 8, 159, 15);
            AddHit(wxRect(x, 151, 31, 31), "Board:" + label);
            x += 32;
        }
        x += 20;
        dc.SetPen(wxPen(wxColour(51, 70, 80))); dc.DrawLine(x - 9, 126, x - 9, 194);
        for (const auto& tab : manifest_.value("tabs", nlohmann::json::array())) {
            if (Field(tab, "tab") != tab_) continue;
            for (const auto& group : tab.value("groups", nlohmann::json::array())) {
                const int groupStart = x;
                dc.SetFont(Font(9, true)); dc.SetTextForeground(wxColour(119, 145, 157));
                dc.DrawText(Field(group, "label"), x, 128);
                for (const auto& tool : group.value("tools", nlohmann::json::array())) {
                    const int widthTool = std::max(68, dc.GetTextExtent(Field(tool, "label")).x + 12);
                    const auto label = Field(tool, "label");
                    const auto action = "Command:" + Field(tool, "id");
                    const auto predicate = Field(tool, "disabledWhen");
                    const bool disabled = predicate == "true" || (label == "Stop" && !worker_busy_)
                        || (predicate.Contains("!boardData") && !design_loaded_)
                        || predicate.Contains("!emiPreflight") || predicate.Contains("!emiFieldResult")
                        || predicate.Contains("!emergeEmiExtension") || predicate.Contains("!desktopShell")
                        || (predicate == "emiBusy" && worker_busy_);
                    if (action == hovered_ && !disabled) Fill(dc, wxRect(x, 146, widthTool, 52), wxColour(38, 59, 72));
                    const auto colour = disabled ? wxColour(80, 98, 109) : wxColour(169, 186, 195);
                    Icon(dc, Field(tool, "icon"), colour, x + widthTool / 2 - 9, 151, 18);
                    dc.SetFont(Font(10)); dc.SetTextForeground(colour);
                    dc.DrawText(label, x + (widthTool - dc.GetTextExtent(label).x) / 2, 177);
                    if (!disabled) AddHit(wxRect(x, 146, widthTool, 52), action);
                    x += widthTool + 4;
                }
                x += 21;
                dc.SetPen(wxPen(wxColour(51, 70, 80))); dc.DrawLine(x - 10, 126, x - 10, 194);
                if (x == groupStart) break;
            }
            break;
        }
        tool_max_ = std::max(0, x + tool_scroll_ - width + 17);
        if (x < width - 180) {
            const auto statusColour = worker_ready_ ? wxColour(98, 196, 139) : wxColour(225, 169, 71);
            dc.SetPen(wxPen(statusColour)); dc.SetBrush(wxBrush(statusColour));
            dc.DrawCircle(width - 138, 166, 3);
            dc.SetFont(Font(10)); dc.SetTextForeground(wxColour(146, 165, 174));
            dc.DrawText(worker_busy_ ? "Desktop worker busy" : worker_ready_ ? "Desktop worker ready" : "Desktop worker unavailable", width - 130, 158);
            dc.SetFont(Font(8)); dc.SetTextForeground(wxColour(95, 117, 128));
            dc.DrawText("spike/v1", width - 54, 177);
        }
    }
    void OnClick(wxMouseEvent& event) {
        for (auto iterator = hits_.rbegin(); iterator != hits_.rend(); ++iterator) {
            if (!iterator->rect.Contains(event.GetPosition())) continue;
            if (iterator->action.StartsWith("Menu:")) {
                const auto label = iterator->action.Mid(5);
                for (const auto& menu : manifest_.value("menus", nlohmann::json::array())) {
                    if (Field(menu, "label") != label) continue;
                    auto* popup = new MenuPopup(this, menu["items"], icons_, dispatch_);
                    popup->Position(ClientToScreen(iterator->rect.GetBottomLeft()), wxSize(0, 0));
                    popup->Popup();
                    return;
                }
            }
            dispatch_(iterator->action); return;
        }
    }
    const nlohmann::json& manifest_;
    std::filesystem::path assets_;
    IconCache icons_;
    wxBitmap logo_;
    std::function<void(const wxString&)> dispatch_;
    std::vector<Hit> hits_;
    wxString tab_{"Home"}, project_{"Untitled project"};
    wxString view_mode_{"3D"};
    wxString hovered_;
    int tab_scroll_{0}, tool_scroll_{0};
    int tab_max_{0}, tool_max_{0};
    bool visible_{true};
    bool worker_ready_{false}, worker_busy_{false};
    bool design_loaded_{false};
};

void Style(wxWindow* window, const wxColour& background = kPanel) {
    window->SetBackgroundColour(background); window->SetForegroundColour(kText);
    window->SetFont(Font(10));
}

class DarkSplitter final : public wxSplitterWindow {
public:
    explicit DarkSplitter(wxWindow* parent) : wxSplitterWindow(parent, wxID_ANY, wxDefaultPosition,
        wxDefaultSize, wxSP_NOBORDER | wxSP_LIVE_UPDATE | wxSP_THIN_SASH) { SetBackgroundColour(kBorder); }
    void DrawSash(wxDC& dc) override {
        if (!IsSplit()) return;
        const auto size = GetClientSize();
        Fill(dc, GetSplitMode() == wxSPLIT_VERTICAL
            ? wxRect(GetSashPosition(), 0, GetSashSize(), size.y)
            : wxRect(0, GetSashPosition(), size.x, GetSashSize()), kBorder);
    }
};

wxPanel* MakePane(wxWindow* parent, const wxString& title) {
    auto* panel = new wxPanel(parent); Style(panel);
    auto* layout = new wxBoxSizer(wxVERTICAL);
    auto* heading = new wxStaticText(panel, wxID_ANY, title);
    heading->SetFont(Font(9, true)); heading->SetForegroundColour(wxColour(119, 145, 157));
    layout->Add(heading, 0, wxEXPAND | wxALL, 12);
    panel->SetSizer(layout);
    return panel;
}
}  // namespace

class DarkPages final : public wxPanel {
public:
    explicit DarkPages(wxWindow* parent, bool show_tabs = true) : wxPanel(parent) {
        Style(this);
        auto* layout = new wxBoxSizer(wxVERTICAL);
        strip_ = new wxPanel(this); strip_->SetMinSize(wxSize(-1, 31));
        strip_->SetBackgroundStyle(wxBG_STYLE_PAINT);
        strip_->Bind(wxEVT_PAINT, [this](wxPaintEvent&) {
            wxAutoBufferedPaintDC dc(strip_);
            Fill(dc, strip_->GetClientRect(), wxColour(17, 29, 37));
            dc.SetFont(Font(9));
            int x = 7;
            hits_.clear();
            for (unsigned i = 0; i < labels_.size(); ++i) {
                const int width = dc.GetTextExtent(labels_[i]).x + 24;
                if (i == selection_) {
                    Fill(dc, wxRect(x, 0, width, 30), wxColour(27, 44, 53));
                    Fill(dc, wxRect(x, 29, width, 2), kGold);
                }
                dc.SetTextForeground(i == selection_ ? kGold : kMuted);
                dc.DrawText(labels_[i], x + 12, 8);
                hits_.push_back(wxRect(x, 0, width, 31));
                x += width + 3;
            }
        });
        strip_->Bind(wxEVT_LEFT_DOWN, [this](wxMouseEvent& event) {
            for (unsigned i = 0; i < hits_.size(); ++i)
                if (hits_[i].Contains(event.GetPosition())) { SetSelection(i); break; }
        });
        layout->Add(strip_, 0, wxEXPAND);
        strip_->Show(show_tabs);
        book_ = new wxSimplebook(this, wxID_ANY, wxDefaultPosition, wxDefaultSize, wxBORDER_NONE);
        Style(book_);
        layout->Add(book_, 1, wxEXPAND);
        SetSizer(layout);
    }
    void AddPage(wxWindow* page, const wxString& label) {
        labels_.push_back(label);
        book_->AddPage(page, label);
        strip_->Refresh();
    }
    unsigned GetPageCount() const { return book_->GetPageCount(); }
    wxString GetPageText(unsigned index) const { return labels_.at(index); }
    wxWindow* GetPage(unsigned index) const { return book_->GetPage(index); }
    wxWindow* PageParent() const { return book_; }
    void SetSelection(unsigned index) {
        if (index >= labels_.size()) return;
        selection_ = index; book_->SetSelection(index); strip_->Refresh();
    }
private:
    wxPanel* strip_{nullptr};
    wxSimplebook* book_{nullptr};
    std::vector<wxString> labels_;
    std::vector<wxRect> hits_;
    unsigned selection_{0};
};

UiShell::UiShell(std::filesystem::path resources)
    : wxFrame(nullptr, wxID_ANY, "SPIKE - wxWidgets UI replica", wxDefaultPosition, wxSize(1440, 900)),
      resources_(std::move(resources)), worker_timer_(this) {
    std::ifstream input(resources_ / "ui_manifest.json");
    if (!input) throw std::runtime_error("ui_manifest.json is missing");
    input >> manifest_;
    SetMinSize(wxSize(1024, 700));
    Style(this, kShell);
    BuildWorkspace();
    Bind(wxEVT_CLOSE_WINDOW, [this](wxCloseEvent& event) {
        if (!event.CanVeto() || (!dirty_ && !worker_.busy())) { event.Skip(); return; }
        event.Veto(); GuardUnsaved([this] { Destroy(); });
    });
    Bind(wxEVT_CHAR_HOOK, [this](wxKeyEvent& event) {
        if (event.ControlDown() && (event.GetKeyCode() == 'K' || event.GetKeyCode() == 'k')) {
            Dispatch("Search");
            return;
        }
        if (event.ControlDown()) {
            if (event.GetKeyCode() == 'N') { Dispatch("New project"); return; }
            if (event.GetKeyCode() == 'O') { Dispatch("Open project"); return; }
            if (event.GetKeyCode() == 'S') { Dispatch(event.ShiftDown() ? "Save as" : "Save project"); return; }
        }
        if (!event.ControlDown() && !event.AltDown() && !dynamic_cast<wxTextCtrl*>(wxWindow::FindFocus())
            && !dynamic_cast<FlatChoice*>(wxWindow::FindFocus())) {
            const std::map<int, wxString> shortcuts{
                {'F', "Board:Fit"}, {'T', "Board:Top"}, {'B', "Board:Bottom"}, {'I', "Board:Iso"},
                {'P', "Board:Pan"}, {'O', "Board:Orbit"}, {'L', "Layers"}, {'R', "Toggle ribbon"},
                {'N', "Design navigator"}, {'A', "Analysis panel"}, {'D', "Results and console"},
                {'G', "Tab:Mesh"}, {'U', "Tab:Solve"}, {'=', "Board:Zoom in"}, {'-', "Board:Zoom out"},
                {WXK_UP, "Board:Pan up"}, {WXK_DOWN, "Board:Pan down"},
                {WXK_LEFT, "Board:Pan left"}, {WXK_RIGHT, "Board:Pan right"}};
            if (const auto found = shortcuts.find(event.GetKeyCode()); found != shortcuts.end()) { Dispatch(found->second); return; }
            if (event.GetKeyCode() == 'V') { Dispatch(view_mode_ == "3D" ? "Board:2D" : "Board:3D"); return; }
        }
        event.Skip();
    });
    for (auto candidate = resources_; !candidate.empty(); candidate = candidate.parent_path()) {
        if (std::filesystem::exists(candidate / "python/spike_core/service.py")) {
            repository_ = candidate; break;
        }
        if (candidate == candidate.parent_path()) break;
    }
    if (!repository_.empty()) {
        const auto localPython = repository_ / ".venv/Scripts/python.exe";
        const wxString executable = std::filesystem::exists(localPython)
            ? wxString(localPython.wstring()) : wxString("python");
        const wxString command = "\"" + executable + "\" -m wx_ui_experiment.worker_adapter";
        const bool started = worker_.start(command, wxString(repository_.wstring()));
        if (worker_status_) worker_status_->SetLabel(started ? "WORKER  |  READY" : "WORKER  |  UNAVAILABLE");
        static_cast<ChromePanel*>(chrome_)->SetWorkerState(started, false);
        worker_timer_.Start(25);
        Bind(wxEVT_TIMER, [this](wxTimerEvent&) {
            worker_.poll();
            if (worker_status_) worker_status_->SetLabel(worker_.busy() ? "WORKER  |  BUSY"
                : worker_.ready() ? "WORKER  |  READY" : "WORKER  |  UNAVAILABLE");
            static_cast<ChromePanel*>(chrome_)->SetWorkerState(worker_.ready(), worker_.busy());
        }, worker_timer_.GetId());
    }
    Centre();
}

void UiShell::BuildWorkspace() {
    auto* layout = new wxBoxSizer(wxVERTICAL);
    chrome_ = new ChromePanel(this, manifest_, resources_ / "assets", [this](const wxString& action) { Dispatch(action); });
    layout->Add(chrome_, 0, wxEXPAND);
    vertical_split_ = new DarkSplitter(this);
    left_split_ = new DarkSplitter(vertical_split_);
    right_split_ = new DarkSplitter(left_split_);
    left_ = MakePane(left_split_, "SCENE NAVIGATOR");
    auto* leftSizer = static_cast<wxBoxSizer*>(left_->GetSizer());
    search_ = new wxTextCtrl(left_, wxID_ANY, {}, wxDefaultPosition, wxDefaultSize, wxTE_PROCESS_ENTER | wxBORDER_NONE);
    search_->SetHint("Search nets, parts, layers..."); Style(search_, wxColour(15, 25, 32));
    leftSizer->Add(search_, 0, wxEXPAND | wxLEFT | wxRIGHT | wxBOTTOM, 9);
    scene_tree_ = new wxTreeCtrl(left_, wxID_ANY, wxDefaultPosition, wxDefaultSize, wxTR_HAS_BUTTONS | wxTR_HIDE_ROOT | wxBORDER_NONE);
    Style(scene_tree_, kPanel);
    leftSizer->Add(scene_tree_, 1, wxEXPAND | wxLEFT | wxRIGHT, 7);
    search_->Bind(wxEVT_TEXT, [this](wxCommandEvent&) { PopulateNavigator(); });
    PopulateNavigator();
    worker_status_ = new wxStaticText(left_, wxID_ANY, "WORKER  |  NOT CONNECTED");
    worker_status_->SetForegroundColour(kMuted);
    leftSizer->Add(worker_status_, 0, wxALL, 12);

    auto* center = new wxPanel(right_split_); Style(center, kCanvas);
    auto* centerSizer = new wxBoxSizer(wxVERTICAL);
    auto* toolbar = new wxPanel(center); Style(toolbar, wxColour(17, 30, 38));
    auto* toolbarSizer = new wxBoxSizer(wxHORIZONTAL);
    IconCache toolbarIcons(resources_ / "assets");
    for (const auto& item : std::vector<std::pair<wxString, wxString>>{
        {"2D", ""}, {"3D", ""}, {"All", "MousePointer2"}, {"Part", "Component"},
        {"Net", "Route"}, {"Layers", "GalleryVertical"}, {"Fit", "Focus"},
        {"Focus selected", "Crosshair"}}) {
        const int width = item.first == "Focus selected" ? 106 : item.second.empty() ? 36 : 58;
        auto* button = new FlatButton(toolbar, item.first, wxSize(width, 28),
            toolbarIcons.Get(item.second, kMuted, 14));
        button->SetActive(item.first == "3D" || item.first == "All");
        if (item.first == "Focus selected") button->Disable();
        viewport_buttons_[item.first] = button;
        button->SetToolTip(item.first);
        button->Bind(wxEVT_BUTTON, [this, value = item.first](wxCommandEvent&) { Dispatch("Board:" + value); });
        toolbarSizer->Add(button, 0, wxALIGN_CENTER_VERTICAL | wxRIGHT, 3);
    }
    toolbarSizer->AddStretchSpacer();
    camera_view_ = new FlatChoice(toolbar, wxSize(78, 28),
        wxArrayString{"VIEW", "Top", "Bottom", "Front", "Back", "Left", "Right", "Iso"});
    Style(camera_view_); camera_view_->SetFont(Font(9)); camera_view_->SetSelection(0);
    camera_view_->Bind(wxEVT_CHOICE, [this](wxCommandEvent&) {
        viewport_->SetCameraView(camera_view_->GetStringSelection().Lower().ToStdString()); camera_view_->SetSelection(0);
    });
    toolbarSizer->Add(camera_view_, 0, wxALIGN_CENTER_VERTICAL | wxRIGHT, 4);
    for (const auto& item : std::vector<std::pair<wxString, wxString>>{
        {"Orbit", "Orbit"}, {"Pan", "Hand"}, {"Pan up", "ArrowUp"}, {"Pan down", "ArrowDown"},
        {"Pan left", "ArrowLeft"}, {"Pan right", "ArrowRight"}, {"Zoom in", "ZoomIn"}, {"Zoom out", "ZoomOut"}}) {
        auto* button = new FlatButton(toolbar, "", wxSize(27, 28), toolbarIcons.Get(item.second, kMuted, 15));
        button->SetName(item.first); button->SetToolTip(item.first); viewport_buttons_[item.first] = button;
        button->Bind(wxEVT_BUTTON, [this, value = item.first](wxCommandEvent&) { Dispatch("Board:" + value); });
        toolbarSizer->Add(button, 0, wxALIGN_CENTER_VERTICAL | wxRIGHT, 2);
    }
    toolbar->SetSizer(toolbarSizer);
    centerSizer->Add(toolbar, 0, wxEXPAND | wxALL, 5);
    auto* context = new wxStaticText(center, wxID_ANY, "  BOARD VIEWPORT    |    SOURCE LAYOUT                                  Geometry   Voltage   Drop   Current   Density   Mesh");
    context->SetFont(Font(9)); context->SetForegroundColour(kMuted);
    centerSizer->Add(context, 0, wxEXPAND | wxTOP | wxBOTTOM, 8);
    viewport_ = new spike::ui::VtkCanvas(center);
    centerSizer->Add(viewport_, 1, wxEXPAND);
    auto* strip = new wxPanel(center); Style(strip, wxColour(20, 35, 44));
    auto* stripSizer = new wxBoxSizer(wxHORIZONTAL);
    for (const auto& text : {"ACTIVE ANALYSIS\nDC IR Drop", "MAX DROP\n-- mV", "MAX CURRENT DENSITY\n-- A/mm2", "MODEL STATUS\nNo result"}) {
        auto* metric = new wxStaticText(strip, wxID_ANY, text);
        metric->SetFont(Font(10)); metric->SetForegroundColour(kText);
        stripSizer->Add(metric, 0, wxALIGN_CENTER_VERTICAL | wxLEFT | wxRIGHT, 18);
    }
    auto* run = new FlatButton(strip, "Run DC", wxSize(89, 36), toolbarIcons.Get("Play", kText, 14));
    run->SetAccent(true);
    run->Bind(wxEVT_BUTTON, [this](wxCommandEvent&) { Dispatch("Run DC"); });
    stripSizer->AddStretchSpacer(); stripSizer->Add(run, 0, wxALIGN_CENTER_VERTICAL | wxRIGHT, 15);
    strip->SetSizer(stripSizer); centerSizer->Add(strip, 0, wxEXPAND, 0); strip->SetMinSize(wxSize(-1, 70));
    center->SetSizer(centerSizer);

    right_ = MakePane(right_split_, "ANALYSIS SETUP");
    setup_pages_ = new DarkPages(right_, false);
    auto* homeSetup = new wxPanel(setup_pages_->PageParent()); Style(homeSetup);
    auto* homeSizer = new wxBoxSizer(wxVERTICAL);
    const auto addHeading = [homeSetup, homeSizer](const wxString& label) {
        auto* text = new wxStaticText(homeSetup, wxID_ANY, label);
        text->SetFont(Font(8, true)); text->SetForegroundColour(kMuted);
        homeSizer->Add(text, 0, wxTOP | wxLEFT | wxRIGHT | wxBOTTOM, 12);
    };
    const auto addChoice = [homeSetup, homeSizer](const wxArrayString& values) {
        auto* choice = new FlatChoice(homeSetup, wxSize(-1, 31), values);
        Style(choice, wxColour(17, 29, 37)); choice->SetSelection(0);
        homeSizer->Add(choice, 0, wxEXPAND | wxLEFT | wxRIGHT, 12);
        return choice;
    };
    addHeading("ANALYSIS MODE");
    analysis_mode_ = addChoice({"DC IR Drop", "Bulk Net Analysis", "AC Impedance Sweep", "Transient PI"});
    analysis_mode_->Bind(wxEVT_CHOICE, [this](wxCommandEvent&) {
        MarkDirty();
        if (status_) status_->SetLabel("  " + analysis_mode_->GetStringSelection() + " setup selected");
    });
    addHeading("SOLVER ENGINE");
    addChoice({"Auto-select compatible engine"});
    addHeading("FORMULATION");
    addChoice({"Automatic formulation"});
    auto* note = new wxStaticText(homeSetup, wxID_ANY,
        "Solver choices depend on worker capability and design readiness.");
    note->Wrap(230); note->SetForegroundColour(kGold);
    homeSizer->Add(note, 0, wxALL, 12);
    addHeading("MANAGED NETS");
    auto* noNets = new wxStaticText(homeSetup, wxID_ANY, "Import a design to inspect managed nets.");
    noNets->SetForegroundColour(kMuted);
    homeSizer->Add(noNets, 0, wxLEFT | wxRIGHT | wxBOTTOM, 12);
    auto* manager = new FlatButton(homeSetup, "Open Net Manager", wxSize(-1, 31), toolbarIcons.Get("ListTree", kMuted, 14));
    manager->Bind(wxEVT_BUTTON, [this](wxCommandEvent&) { Dispatch("Net Manager"); });
    homeSizer->Add(manager, 0, wxEXPAND | wxLEFT | wxRIGHT, 12);
    homeSizer->AddStretchSpacer(); homeSetup->SetSizer(homeSizer);
    setup_pages_->AddPage(homeSetup, "Home");
    for (const auto& label : {"PI", "Mesh", "Solve", "HF / SI", "EM", "Thermal"}) {
        auto* page = MakePane(setup_pages_->PageParent(), wxString(label) + " SETTINGS");
        auto* sizer = static_cast<wxBoxSizer*>(page->GetSizer());
        auto* hint = new wxStaticText(page, wxID_ANY, "Select a command in the ribbon to configure this workflow.");
        hint->Wrap(230); hint->SetForegroundColour(kMuted); sizer->Add(hint, 0, wxALL, 10);
        setup_pages_->AddPage(page, label);
    }
    static_cast<wxBoxSizer*>(right_->GetSizer())->Add(setup_pages_, 1, wxEXPAND | wxLEFT | wxRIGHT, 5);

    bottom_ = new wxPanel(vertical_split_); Style(bottom_);
    bottom_->SetSizer(new wxBoxSizer(wxVERTICAL));
    bottom_pages_ = new DarkPages(bottom_);
    for (const auto& label : {"Issues", "Probe table", "Power tree", "Console"}) {
        auto* text = new wxTextCtrl(bottom_pages_->PageParent(), wxID_ANY,
            wxString(label) == "Issues" ? "No validation has been run." : "No results yet.",
            wxDefaultPosition, wxDefaultSize, wxTE_MULTILINE | wxTE_READONLY | wxBORDER_NONE);
        Style(text, wxColour(18, 30, 37)); bottom_pages_->AddPage(text, label);
    }
    static_cast<wxBoxSizer*>(bottom_->GetSizer())->Add(bottom_pages_, 1, wxEXPAND);
    right_split_->SetMinimumPaneSize(180); right_split_->SplitVertically(center, right_, -272);
    left_split_->SetMinimumPaneSize(160); left_split_->SplitVertically(left_, right_split_, 224);
    vertical_split_->SetMinimumPaneSize(120); vertical_split_->SplitHorizontally(left_split_, bottom_, -178);
    right_split_->SetBackgroundColour(kBorder); left_split_->SetBackgroundColour(kBorder);
    vertical_split_->SetBackgroundColour(kBorder);
    layout->Add(vertical_split_, 1, wxEXPAND);
    status_ = new wxStaticText(this, wxID_ANY, "  Ready  |  No design loaded                                      SPIKE wxWidgets / VTK experiment");
    Style(status_, wxColour(11, 19, 24)); status_->SetFont(Font(9)); status_->SetMinSize(wxSize(-1, 25));
    layout->Add(status_, 0, wxEXPAND);
    SetSizer(layout);
}

void UiShell::RefreshProjectChrome() {
    const wxString name = session_.project_path().empty() ? wxString("untitled.spike")
        : wxFileName(Utf8(session_.project_path())).GetFullName();
    static_cast<ChromePanel*>(chrome_)->SetProject(name + (dirty_ ? " *" : ""));
    static_cast<ChromePanel*>(chrome_)->SetDesignLoaded(design_.is_object());
}

void UiShell::SetActiveTab(const wxString& tab) {
    current_tab_ = tab;
    static_cast<ChromePanel*>(chrome_)->SetTab(tab);
    const wxString pages[] = {"Home", "PI", "Mesh", "Solve", "HF / SI", "EM", "Thermal"};
    for (unsigned index = 0; index < setup_pages_->GetPageCount(); ++index) {
        if (index < 7 && tab == pages[index]) { setup_pages_->SetSelection(index); break; }
    }
}

void UiShell::SelectBottom(const wxString& page) {
    for (unsigned index = 0; index < bottom_pages_->GetPageCount(); ++index) {
        if (bottom_pages_->GetPageText(index) == page) { bottom_pages_->SetSelection(index); break; }
    }
}

void UiShell::NewProject() {
    GuardUnsaved([this] {
    session_.clear(); dirty_ = false; ++edit_revision_;
    design_ = nullptr;
    managed_nets_.clear(); layer_visibility_.clear();
    board_path_.clear();
    static_cast<ChromePanel*>(chrome_)->SetProject("untitled.spike");
    viewport_->ClearScene();
    PopulateNavigator();
    for (unsigned index = 0; index < bottom_pages_->GetPageCount(); ++index) {
        if (auto* page = dynamic_cast<wxTextCtrl*>(bottom_pages_->GetPage(index)))
            page->SetValue(index == 0 ? "No design loaded." : "No results yet.");
    }
    SetActiveTab("Home");
    RefreshProjectChrome();
    });
}

void UiShell::ShowProjectManager() {
    constexpr int kNew = wxID_HIGHEST + 201;
    constexpr int kOpen = wxID_HIGHEST + 202;
    constexpr int kSave = wxID_HIGHEST + 203;
    constexpr int kSaveAs = wxID_HIGHEST + 204;
    wxDialog dialog(this, wxID_ANY, "Project manager", wxDefaultPosition,
                    wxSize(1040, 600), wxDEFAULT_DIALOG_STYLE | wxRESIZE_BORDER);
    Style(&dialog, wxColour(17, 31, 39));
    auto* layout = new wxBoxSizer(wxVERTICAL);
    auto* title = new wxStaticText(&dialog, wxID_ANY, "Project manager");
    title->SetFont(Font(14, true)); title->SetForegroundColour(kText);
    layout->Add(title, 0, wxALL, 17);
    auto* subtitle = new wxStaticText(&dialog, wxID_ANY, "SPIKE project package and recent work");
    subtitle->SetForegroundColour(kMuted);
    layout->Add(subtitle, 0, wxLEFT | wxRIGHT | wxBOTTOM, 17);
    auto* metadata = new wxBoxSizer(wxHORIZONTAL);
    const wxString projectName = board_path_.EndsWith(".spike")
        ? wxFileName(board_path_).GetFullName() : wxString("untitled.spike");
    auto* project = new wxStaticText(&dialog, wxID_ANY,
        wxString("CURRENT PROJECT\n") + projectName + "\n" +
        (board_path_.EndsWith(".spike") ? board_path_ : wxString("Not saved to a native path")));
    auto* design = new wxStaticText(&dialog, wxID_ANY,
        wxString("IMPORTED DESIGN\n") +
        (design_.is_object() ? wxFileName(board_path_).GetFullName() : wxString("No design loaded")));
    project->SetForegroundColour(kText); design->SetForegroundColour(kText);
    metadata->Add(project, 1, wxEXPAND | wxALL, 16);
    metadata->Add(design, 1, wxEXPAND | wxALL, 16);
    layout->Add(metadata, 0, wxEXPAND);
    auto* actions = new wxBoxSizer(wxHORIZONTAL);
    for (const auto& item : std::vector<std::pair<wxString, int>>{
             {"New project", kNew}, {"Open", kOpen}, {"Save", kSave}, {"Save as", kSaveAs}}) {
        auto* button = new FlatButton(&dialog, item.first, wxSize(170, 55));
        if ((item.second == kSave || item.second == kSaveAs) && !session_.has_project()) {
            button->Disable();
            button->SetToolTip("Import a design or open a project before saving.");
        } else {
            button->Bind(wxEVT_BUTTON, [&dialog, id = item.second](wxCommandEvent&) { dialog.EndModal(id); });
        }
        actions->Add(button, 1, wxEXPAND);
    }
    layout->Add(actions, 0, wxEXPAND);
    auto* note = new wxStaticText(&dialog, wxID_ANY,
        "Project packages use the shared SPIKE worker and preserve saved state.");
    note->SetForegroundColour(kMuted);
    layout->Add(note, 1, wxEXPAND | wxALL, 16);
    auto* close = new wxButton(&dialog, wxID_CANCEL, "Close");
    layout->Add(close, 0, wxALIGN_RIGHT | wxALL, 12);
    dialog.SetSizer(layout);
    dialog.CentreOnParent();
    const int action = dialog.ShowModal();
    if (action == kNew) NewProject();
    else if (action == kOpen) LoadBoard(true);
    else if (action == kSave || action == kSaveAs) SaveProject(action == kSaveAs);
}

void UiShell::LoadBoard(bool project_only) {
    GuardUnsaved([this, project_only] { LoadBoardNow(project_only); });
}

void UiShell::LoadBoardNow(bool project_only) {
    wxFileDialog dialog(this, project_only ? "Open SPIKE project" : "Import SPIKE design", {}, {},
        project_only ? "SPIKE project (*.spike)|*.spike"
                     : "KiCad board (*.kicad_pcb)|*.kicad_pcb|SPIKE project (*.spike)|*.spike",
        wxFD_OPEN | wxFD_FILE_MUST_EXIST);
    if (dialog.ShowModal() != wxID_OK) return;
    const wxString selectedPath = dialog.GetPath();
    if (!worker_.ready()) {
        wxMessageBox("The SPIKE worker is unavailable. Start from the repository with its Python environment installed.",
            "Import unavailable", wxOK | wxICON_ERROR, this);
        return;
    }
    const std::string path(selectedPath.ToUTF8().data());
    const bool package = selectedPath.EndsWith(".spike");
    const auto request = package ? spike::wxui::ProjectSession::project_open_request(path)
        : spike::wxui::ProjectSession::design_import_request(path);
    if (!worker_.send(request.method, request.params, [this, package, selectedPath](spike::wxui::WorkerBridge::Reply reply) {
        if (!reply.ok) {
            wxMessageBox(Utf8(reply.error.message), "Import failed", wxOK | wxICON_ERROR, this);
            return;
        }
        try {
            spike::wxui::ProjectSession next;
            if (package) next.accept_project_open(std::string(selectedPath.ToUTF8().data()), reply.result);
            else {
                next.accept_design_import(std::string(selectedPath.ToUTF8().data()), reply.result);
                std::ifstream source(std::filesystem::path(selectedPath.ToStdWstring()), std::ios::binary);
                if (!source) throw std::runtime_error("Cannot retain the imported source for project saving.");
                const std::string sourceText((std::istreambuf_iterator<char>(source)), std::istreambuf_iterator<char>());
                next.create_project_from_import("untitled.spike", sourceText);
            }
            const auto* nativeDesign = next.design();
            if (!nativeDesign) throw std::runtime_error("The worker did not return a displayable design contract.");
            design_ = *nativeDesign;
            session_ = std::move(next);
            managed_nets_.clear(); layer_visibility_.clear();
            if (session_.project().contains("analysis") && session_.project()["analysis"].is_object()) {
                const auto& analysis = session_.project()["analysis"];
                if (analysis.contains("power_nets") && analysis["power_nets"].is_array())
                    for (const auto& net : analysis["power_nets"]) if (net.is_string()) managed_nets_.push_back(net.get<std::string>());
                if (analysis.contains("mode") && analysis["mode"].is_string()) {
                    const int index = analysis_mode_->FindString(Utf8(analysis["mode"].get<std::string>()));
                    if (index != wxNOT_FOUND) analysis_mode_->SetSelection(index);
                }
            }
            dirty_ = !package; ++edit_revision_;
            board_path_ = selectedPath;
            static_cast<ChromePanel*>(chrome_)->SetProject(
                package ? wxFileName(board_path_).GetFullName() : wxString("untitled.spike"));
            viewport_->LoadBoardJson(design_);
            PopulateNavigator();
            RefreshProjectChrome();
            status_->SetLabel("  " + wxString(package ? "Opened project: " : "Imported design: ") + selectedPath);
            SelectBottom("Issues");
        } catch (const std::exception& error) {
            wxMessageBox(Utf8(error.what()), "Unsupported design response", wxOK | wxICON_ERROR, this);
        }
    })) {
        wxMessageBox(Utf8(worker_.last_error().message), "Import unavailable", wxOK | wxICON_ERROR, this);
    }
}

void UiShell::PopulateNavigator() {
    if (!scene_tree_) return;
    scene_tree_->DeleteAllItems();
    const auto root = scene_tree_->AddRoot("Design");
    if (!design_.is_object()) {
        scene_tree_->AppendItem(root, "No design loaded");
        scene_tree_->Expand(root);
        return;
    }
    const wxString query = search_ ? search_->GetValue().Lower() : wxString();
    for (const auto& key : {"nets", "components", "tracks", "pads", "vias", "zones"}) {
        if (!design_.contains(key)) continue;
        const auto& collection = design_[key];
        if (!collection.is_array() && !collection.is_object()) continue;
        const auto parent = scene_tree_->AppendItem(root,
            wxString::FromUTF8(key) + " (" + wxString::Format("%zu", collection.size()) + ")");
        std::size_t count = 0;
        std::size_t scanned = 0;
        const auto append = [&](const nlohmann::json& value, const std::string& fallback) {
            if (count >= 200) return;
            wxString display = Utf8(fallback);
            if (value.is_string()) display = Utf8(value.get<std::string>());
            else if (value.is_object()) {
                for (const auto& field : {"name", "ref", "id"}) {
                    const auto candidate = Field(value, field);
                    if (!candidate.empty()) { display = candidate; break; }
                }
            }
            if (query.empty() || display.Lower().Contains(query)) {
                scene_tree_->AppendItem(parent, display); ++count;
            }
        };
        if (collection.is_array()) {
            for (std::size_t index = 0; index < collection.size() && count < 200 && scanned++ < 2000; ++index)
                append(collection[index], std::to_string(index + 1));
        } else {
            for (auto iterator = collection.begin(); iterator != collection.end() && count < 200 && scanned++ < 2000; ++iterator)
                append(iterator.value(), iterator.key());
        }
        scene_tree_->Expand(parent);
    }
    scene_tree_->Expand(root);
}

void UiShell::ShowPrototypePanel(const wxString& title) {
    wxMessageBox(title + " is present in the exact ribbon map. Its native workflow is still being implemented.",
        "SPIKE UI experiment", wxOK | wxICON_INFORMATION, this);
}

void UiShell::Dispatch(const wxString& action) {
    if (action.StartsWith("Command:")) {
        const auto id = action.Mid(8);
        const auto execute = [this, &id](const nlohmann::json& item) {
            if (Field(item, "id") != id) return false;
            const auto handler = Field(item, "handler");
            const auto target = Field(item, "targetWorkspace");
            if (!target.empty()) { SetActiveTab(target); return true; }
            if (handler.Contains("setSimulationDomain")) {
                simulation_domain_ = handler.Contains("\"si\"") ? "si" : "pi";
                status_->SetLabel("  Shared " + simulation_domain_.Upper() + " domain selected");
                return true;
            }
            if (handler.Contains("setLayersOpen")) { ShowLayerManager(); return true; }
            if (handler.Contains("setStackupOpen")) { ShowStackup(); return true; }
            if (handler.Contains("setNetManagerOpen")) { ShowNetManager(); return true; }
            if (handler.Contains("openAnalysisSetup")) {
                SetActiveTab("PI");
                for (unsigned i = 0; i < analysis_mode_->GetCount(); ++i)
                    if (handler.Contains("\"" + analysis_mode_->GetString(i) + "\"")) analysis_mode_->SetSelection(i);
                setup_pages_->SetSelection(0);
                status_->SetLabel("  " + analysis_mode_->GetStringSelection() + " setup selected");
                return true;
            }
            if (handler.Contains("setDock(\"Console\")")) { SelectBottom("Console"); return true; }
            if (handler.Contains("setDock(\"Issues\")")) { SelectBottom("Issues"); return true; }
            if (handler == "openProbeTable") { SelectBottom("Probe table"); return true; }
            Dispatch(Field(item, "label"));
            return true;
        };
        for (const auto& tab : manifest_.value("tabs", nlohmann::json::array()))
            for (const auto& group : tab.value("groups", nlohmann::json::array()))
                for (const auto& item : group.value("tools", nlohmann::json::array())) if (execute(item)) return;
        for (const auto& menu : manifest_.value("menus", nlohmann::json::array()))
            for (const auto& item : menu.value("items", nlohmann::json::array())) if (execute(item)) return;
        status_->SetLabel("  Command inventory is out of date: " + id);
        return;
    }
    if (action.StartsWith("Tab:")) { SetActiveTab(action.Mid(4)); return; }
    if (action == "Toggle ribbon" || action == "Minimize command ribbon" || action == "Expand command ribbon") {
        ribbon_visible_ = !ribbon_visible_;
        static_cast<ChromePanel*>(chrome_)->SetRibbonVisible(ribbon_visible_);
        Layout(); return;
    }
    if (action == "Design navigator") {
        left_open_ = !left_open_;
        if (left_open_) left_split_->SplitVertically(left_, right_split_, 224);
        else left_split_->Unsplit(left_);
        return;
    }
    if (action == "Analysis panel") {
        right_open_ = !right_open_;
        if (right_open_) right_split_->SplitVertically(viewport_->GetParent(), right_, -272);
        else right_split_->Unsplit(right_);
        return;
    }
    if (action == "Results and console") {
        bottom_open_ = !bottom_open_;
        if (bottom_open_) vertical_split_->SplitHorizontally(left_split_, bottom_, -178);
        else vertical_split_->Unsplit(bottom_);
        return;
    }
    if (action == "2D layout view") { Dispatch("Board:2D"); return; }
    if (action == "3D board view") { Dispatch("Board:3D"); return; }
    if (action == "New project") { NewProject(); return; }
    if (action == "Manager" || action == "Project manager") { ShowProjectManager(); return; }
    if (action == "Open" || action == "Open project") { LoadBoard(true); return; }
    if (action == "Import") { LoadBoard(false); return; }
    if (action == "Save" || action == "Save project" || action == "Save as") {
        SaveProject(action == "Save as"); return;
    }
    if (action == "Validate" || action == "Validate design") {
        if (!design_.is_object() || !worker_.ready()) { ShowPrototypePanel("Validate design"); return; }
        worker_.send("validate_design", {{"design", design_}}, [this](spike::wxui::WorkerBridge::Reply reply) {
            SelectBottom("Issues");
            auto* text = dynamic_cast<wxTextCtrl*>(bottom_pages_->GetPage(0));
            if (text) text->SetValue(reply.ok ? Utf8(reply.result.dump(2)) : Utf8(reply.error.message));
        });
        return;
    }
    if (action == "Issues" || action == "Probe table" || action == "Power tree" || action == "Console") {
        SelectBottom(action); return;
    }
    if (action == "Board:2D") {
        view_mode_ = "2D";
        viewport_->SetTopView(); viewport_->SetNavigationMode("pan");
        static_cast<ChromePanel*>(chrome_)->SetViewMode(view_mode_);
        viewport_buttons_["2D"]->SetActive(true); viewport_buttons_["3D"]->SetActive(false);
        viewport_buttons_["Orbit"]->Disable(); viewport_buttons_["Pan"]->SetActive(true);
        viewport_buttons_["Orbit"]->SetActive(false); camera_view_->Disable(); return;
    }
    if (action == "Board:3D" || action == "Board:Iso") {
        view_mode_ = "3D";
        viewport_->SetIsometricView(); static_cast<ChromePanel*>(chrome_)->SetViewMode(view_mode_);
        viewport_buttons_["2D"]->SetActive(false); viewport_buttons_["3D"]->SetActive(true);
        viewport_buttons_["Orbit"]->Enable(); camera_view_->Enable(); return;
    }
    if (action == "Board:Pan" || action == "Board:Orbit") {
        if (action == "Board:Orbit" && view_mode_ == "2D") return;
        const bool pan = action == "Board:Pan";
        viewport_->SetNavigationMode(pan ? "pan" : "orbit");
        viewport_buttons_["Pan"]->SetActive(pan); viewport_buttons_["Orbit"]->SetActive(!pan); return;
    }
    if (action == "Board:Zoom in" || action == "Board:Zoom out") { viewport_->Zoom(action == "Board:Zoom in" ? 1.2 : 1.0 / 1.2); return; }
    if (action == "Board:Pan up") { viewport_->Pan(0, 30); return; }
    if (action == "Board:Pan down") { viewport_->Pan(0, -30); return; }
    if (action == "Board:Pan left") { viewport_->Pan(30, 0); return; }
    if (action == "Board:Pan right") { viewport_->Pan(-30, 0); return; }
    if (action == "Board:Translucent") { translucent_ = !translucent_; viewport_->SetTranslucent(translucent_); return; }
    if (action == "Board:Fit") { viewport_->Fit(); return; }
    if (action == "Board:Top") { viewport_->SetTopView(); return; }
    if (action == "Board:Bottom") { viewport_->SetBottomView(); return; }
    if (action == "Mesh settings" || action == "Solve workspace" || action == "PI mesh" || action == "PI solve") {
        SetActiveTab(action == "Solve workspace" || action == "PI solve" ? "Solve" : "Mesh"); return;
    }
    if (action == "DC PI setup" || action == "AC impedance setup" || action == "Transient PI setup") {
        SetActiveTab("PI");
        if (!right_open_) { right_open_ = true; right_split_->SplitVertically(viewport_->GetParent(), right_, -272); }
        return;
    }
    if (action == "EM workspace") { SetActiveTab("EM"); return; }
    if (action == "Result visualization") { SetActiveTab("Results"); SelectBottom("Issues"); return; }
    if (action == "Run DC" || action == "Run PI" || action == "Run controls") {
        if (!design_.is_object()) {
            wxMessageBox("Import a design and configure the analysis before running a solver.",
                         "Analysis setup required", wxOK | wxICON_INFORMATION, this);
            return;
        }
        ShowPrototypePanel("PI solve"); return;
    }
    if (action == "Stop") {
        if (worker_.busy()) worker_.cancel();
        else ShowPrototypePanel("Stop active operation");
        return;
    }
    if (action == "Search") {
        ShowSearchDialog(this, manifest_, [this](const wxString& command) { Dispatch(command); });
        return;
    }
    if (action == "Layers" || action == "Board:Layers") { ShowLayerManager(); return; }
    if (action == "Net Manager" || action == "Net manager" || action == "Nets") { ShowNetManager(); return; }
    if (action == "Stackup") { ShowStackup(); return; }
    if (action == "Settings" || action == "Help and user guide") {
        ShowPrototypePanel(action); return;
    }
    ShowPrototypePanel(action);
}
