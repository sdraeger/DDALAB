% EEGPLUGIN_DDALAB  Adds Tools > DDALAB to EEGLAB: run delay differential analysis with ddalab and plot the result.

function vers = eegplugin_ddalab(fig, trystrs, catchstrs)
vers = '2.9.0';
menu = uimenu(findobj(fig, 'tag', 'tools'), 'label', 'DDALAB', 'separator', 'on');
uimenu(menu, 'label', 'Run DDA', 'tag', 'pop_dda', ...
    'callback', [trystrs.check_cont '[EEG, LASTCOM] = pop_dda(EEG);' catchstrs.store_and_hist]);
uimenu(menu, 'label', 'Plot DDA result', 'tag', 'pop_ddaplot', ...
    'callback', [trystrs.no_check 'LASTCOM = pop_ddaplot(EEG);' catchstrs.add_to_hist]);
end
