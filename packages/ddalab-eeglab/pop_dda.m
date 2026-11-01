% POP_DDA  Runs delay differential analysis (DDA) on a continuous dataset with the DDALAB command-line tool.
%
%   [EEG, com] = pop_dda(EEG);                     % asks for the parameters
%   [EEG, com] = pop_dda(EEG, 'key', value, ...);
%
% Keys, where an empty or omitted value means the ddalab default:
%   'variants'  cell array of variants: 'ST', 'CT', 'CD', 'DE', 'SY'. Default {'ST'}.
%   'channels'  channel indices, 1-based. Default every channel.
%   'wl'        window length in samples.
%   'ws'        window step in samples.
%   'delays'    delays (tau) in samples.
%   'ct_pairs'  N-by-2 channel pairs for CT, 1-based. Required with CT.
%   'cd_pairs'  N-by-2 directed channel pairs (target, source) for CD, 1-based: row "A <- B" is how much B improves
%               the model of A. Required with CD.
%   'binary'    the ddalab executable. Default the DDALAB_CLI environment variable, else ddalab on the PATH.
%
% The result document (schema ddalab.result/2) is stored in EEG.etc.dda; pop_ddaplot draws it.

function [EEG, com] = pop_dda(EEG, varargin)
com = '';
if nargin < 2
    ask = {'Variants (ST CT CD DE SY)' 'ST'; 'Channel indices (blank: all)' ''; ...
        'Window length in samples (blank: default)' ''; 'Window step in samples (blank: default)' ''; ...
        'Delays in samples (blank: default)' ''; 'CT channel pairs, e.g. 1 2; 1 3' ''; ...
        'CD pairs as target source, e.g. 1 2; 2 1' ''};
    uilist = cell(1, 2 * size(ask, 1));
    uilist(1:2:end) = cellfun(@(s) {'style' 'text' 'string' s}, ask(:, 1)', 'uniformoutput', false);
    uilist(2:2:end) = cellfun(@(s) {'style' 'edit' 'string' s}, ask(:, 2)', 'uniformoutput', false);
    res = inputgui('geometry', repmat({[2 1]}, 1, size(ask, 1)), 'uilist', uilist, 'title', 'DDALAB -- pop_dda()');
    if isempty(res), return; end
    numbers = @(s) sscanf(s, '%d')';
    pairs = @(s) reshape(sscanf(strrep(s, ';', ' '), '%d'), 2, [])';
    varargin = {'variants', strsplit(strtrim(res{1})), 'channels', numbers(res{2}), 'wl', numbers(res{3}), ...
        'ws', numbers(res{4}), 'delays', numbers(res{5}), 'ct_pairs', pairs(res{6}), 'cd_pairs', pairs(res{7})};
end
binary = getenv('DDALAB_CLI');
if isempty(binary), binary = 'ddalab'; end
g = finputcheck(varargin, {'variants' 'cell' {} {'ST'}; 'channels' 'integer' [] []; 'wl' 'integer' [] []; ...
    'ws' 'integer' [] []; 'delays' 'integer' [] []; 'ct_pairs' 'integer' [] []; 'cd_pairs' 'integer' [] []; ...
    'binary' 'string' {} binary}, 'pop_dda');
if ischar(g), error(g); end
if EEG.trials > 1
    error('pop_dda: DDALAB reads continuous data, and this dataset is epoched (%d trials)', EEG.trials);
end

% A copy in EEGLAB's own two-file layout, so ddalab sees the data as it is in memory now.
folder = tempname;
mkdir(folder);
cleanup = onCleanup(@() rmdir(folder, 's'));
fid = fopen(fullfile(folder, 'dataset.fdt'), 'w', 'ieee-le');
fwrite(fid, eeg_getdatact(EEG), 'float32');
fclose(fid);
labels = arrayfun(@num2str, 1:EEG.nbchan, 'uniformoutput', false);
if isfield(EEG.chanlocs, 'labels'), labels = {EEG.chanlocs.labels}; end
S.EEG = struct('nbchan', EEG.nbchan, 'srate', EEG.srate, 'trials', 1, 'pnts', EEG.pnts, 'data', 'dataset.fdt', ...
    'chanlocs', struct('labels', labels));
save(fullfile(folder, 'dataset.set'), '-struct', 'S', '-v6');

% ddalab counts channels from 0.
flags = {'--channels', ' %d', g.channels - 1; '--wl', ' %d', g.wl; '--ws', ' %d', g.ws; '--delays', ' %d', g.delays; ...
    '--ct-pairs', ' %d,%d', (g.ct_pairs - 1)'; '--cd-pairs', ' %d,%d', (g.cd_pairs - 1)'};
args = sprintf(' --variants %s', strjoin(g.variants, ' '));
for k = find(~cellfun(@isempty, flags(:, 3)))'
    args = [args ' ' flags{k, 1} sprintf(flags{k, 2}, flags{k, 3})];
end
result = fullfile(folder, 'result.json');
[status, out] = system(sprintf('"%s" run --file "%s"%s --quiet --compact -o "%s"', g.binary, ...
    fullfile(folder, 'dataset.set'), args, result));
if status ~= 0
    error('pop_dda: ddalab failed (is it installed? see the ''binary'' key):\n%s', out);
end
EEG.etc.dda = jsondecode(fileread(result));
com = sprintf('EEG = pop_dda(EEG, %s);', vararg2str(varargin));
end
