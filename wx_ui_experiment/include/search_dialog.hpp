// SPDX-License-Identifier: MIT
#pragma once

#include <functional>

#include <nlohmann/json.hpp>
#include <wx/string.h>

class wxWindow;

// The palette is presentation-only. It dispatches the same command identifiers
// as ribbon and menu clicks; it never executes worker operations itself.
void ShowSearchDialog(wxWindow* parent, const nlohmann::json& manifest,
                      const std::function<void(const wxString&)>& dispatch);
