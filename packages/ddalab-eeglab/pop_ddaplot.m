% POP_DDAPLOT  Plots the DDALAB result that pop_dda stored in EEG.etc.dda: one panel per variant, events as lines.
%
%   com = pop_ddaplot(EEG);

function com = pop_ddaplot(EEG)
if ~isfield(EEG.etc, 'dda'), error('pop_ddaplot: no DDALAB result in EEG.etc.dda; run pop_dda first'); end
V = EEG.etc.dda.variants;
if isstruct(V), V = num2cell(V); end
t = EEG.etc.dda.window_centers_seconds;
events = ([EEG.event.latency] - 1) / EEG.srate;
figure('name', 'DDALAB result');
for k = 1:numel(V)
    subplot(numel(V), 1, k);
    imagesc(t, 1:size(V{k}.matrix, 1), V{k}.matrix);
    set(gca, 'ytick', 1:size(V{k}.matrix, 1), 'yticklabel', V{k}.row_labels);
    colorbar;
    title(V{k}.label);
    line([events; events], repmat(ylim', 1, numel(events)), 'color', 'k');
end
xlabel('Time (s)');
com = 'pop_ddaplot(EEG);';
end
