function test_pop_dda(eeglab_dir, ddalab)
% TEST_POP_DDA  Runs the plugin inside EEGLAB on a dataset EEGLAB itself saved.
%
% pop_dda's result must equal, value for value, what `ddalab run` writes for the saved .set file; an epoched dataset
% must be refused; the plugin must add its menu items; pop_ddaplot must draw.
%
%   matlab -batch "addpath('packages/ddalab-eeglab/test'); test_pop_dda('/path/to/eeglab', '/path/to/ddalab')"

here = fileparts(mfilename('fullpath'));
addpath(fileparts(here));
addpath(eeglab_dir);
eeglab('nogui');
set(0, 'DefaultFigureVisible', 'off');

folder = tempname;
mkdir(folder);
rng(1);
EEG = eeg_emptyset;
EEG.data = single(cumsum(randn(4, 2048), 2));
EEG.srate = 256;
EEG.chanlocs = struct('labels', {'Fp1', 'Fp2', 'Cz', 'Pz'});
EEG.event = struct('type', {'stim', 'resp'}, 'latency', {300, 1200});
EEG = eeg_checkset(EEG);
pop_saveset(EEG, 'filename', 'saved.set', 'filepath', folder);
EEG = pop_loadset('filename', 'saved.set', 'filepath', folder);
[EEG, com] = pop_dda(EEG, 'variants', {'ST', 'CT', 'CD'}, 'ct_pairs', [1 2; 1 3], 'cd_pairs', [1 2; 2 1], ...
    'binary', ddalab);

reference = fullfile(folder, 'reference.json');
command = sprintf(['"%s" run --file "%s" --variants ST CT CD --ct-pairs 0,1 0,2 --cd-pairs 0,1 1,0 ' ...
    '--quiet -o "%s"'], ddalab, ...
    fullfile(folder, 'saved.set'), reference);
[status, out] = system(command);
assert(status == 0, out);
R = jsondecode(fileread(reference));
rmdir(folder, 's');
assert(isequaln(EEG.etc.dda.variants, R.variants), 'pop_dda variants differ from the CLI result');
assert(isequal(EEG.etc.dda.window_centers_seconds, R.window_centers_seconds), 'window centers differ');
assert(~isempty(strfind(com, 'pop_dda(EEG')), com);

unlabeled = EEG;
unlabeled.chanlocs = [];
unlabeled = pop_dda(unlabeled, 'binary', ddalab);
assert(isequal(unlabeled.etc.dda.variants.row_labels, {'1'; '2'; '3'; '4'}), 'channels without locations');

epoched = EEG;
epoched.trials = 2;
refused = false;
try
    pop_dda(epoched, 'binary', ddalab);
catch err
    refused = ~isempty(strfind(err.message, 'epoched'));
end
assert(refused, 'an epoched dataset was not refused');

fig = figure;
uimenu(fig, 'label', 'Tools', 'tag', 'tools');
eegplugin_ddalab(fig, struct('check_cont', '', 'no_check', ''), struct('store_and_hist', '', 'add_to_hist', ''));
assert(~isempty(findobj(fig, 'tag', 'pop_dda')) && ~isempty(findobj(fig, 'tag', 'pop_ddaplot')), 'menu items missing');
close(fig);

assert(strcmp(pop_ddaplot(EEG), 'pop_ddaplot(EEG);'));
close all;
fprintf('test_pop_dda: all checks passed\n');
end
