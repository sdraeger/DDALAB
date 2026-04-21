use crate::error::{DDAError, Result};
use crate::types::DDARequest;

#[derive(Debug, Clone)]
pub(crate) struct ModelSpec {
    pub(crate) dm: usize,
    pub(crate) window_length: usize,
    pub(crate) window_step: usize,
    pub(crate) max_delay: usize,
    pub(crate) primary_terms: Vec<Vec<usize>>,
    pub(crate) secondary_terms: Vec<Vec<usize>>,
}

impl ModelSpec {
    pub(crate) fn from_request(request: &DDARequest) -> Result<Self> {
        let model = request.model_parameters.as_ref();
        let dm = model.map(|m| m.dm as usize).unwrap_or(4);
        let nr_tau = model.map(|m| m.nr_tau as usize).unwrap_or(2);
        let order = model.map(|m| m.order as usize).unwrap_or(4);
        if dm == 0 {
            return Err(DDAError::InvalidParameter(
                "Recovered DDA engine does not support dm=0".to_string(),
            ));
        }
        if nr_tau == 0 {
            return Err(DDAError::InvalidParameter(
                "Recovered DDA engine does not support nr_tau=0".to_string(),
            ));
        }
        let delays = normalize_delays(&request.delay_parameters.delays, nr_tau)?;
        let max_delay = delays.iter().copied().max().unwrap_or(0);
        let model_terms = request
            .model_terms
            .clone()
            .unwrap_or_else(|| crate::types::DEFAULT_MODEL_TERMS.to_vec());
        let monomials = monomial_list(nr_tau, order);
        let primary_terms = select_model_terms(&monomials, &model_terms, &delays)?;
        let secondary_terms = primary_terms.clone();

        Ok(Self {
            dm,
            window_length: request.window_parameters.window_length as usize,
            window_step: request.window_parameters.window_step as usize,
            max_delay,
            primary_terms,
            secondary_terms,
        })
    }
}

pub(crate) fn normalize_delays(delays: &[i32], nr_tau: usize) -> Result<Vec<usize>> {
    if delays.len() < nr_tau {
        return Err(DDAError::InvalidParameter(format!(
            "Received {} delays but nr_tau={} requires at least {}",
            delays.len(),
            nr_tau,
            nr_tau
        )));
    }
    let mut normalized = Vec::with_capacity(nr_tau);
    for delay in delays.iter().take(nr_tau) {
        if *delay < 0 {
            return Err(DDAError::InvalidParameter(format!(
                "Recovered DDA engine expects non-negative delays, got {}",
                delay
            )));
        }
        normalized.push(*delay as usize);
    }
    Ok(normalized)
}

pub(crate) fn nr_multicombinations(nr_tau: usize, order: usize) -> usize {
    let mut combinations = 1usize;
    let mut total = 0usize;
    for degree in 1..=order {
        combinations = ((combinations as f64) * ((degree + nr_tau - 1) as f64 / degree as f64))
            .round() as usize;
        total += combinations;
    }
    total
}

pub(crate) fn monomial_list(nr_tau: usize, order: usize) -> Vec<Vec<usize>> {
    let total = nr_multicombinations(nr_tau, order);
    let mut table = vec![vec![0usize; order]; total];
    let mut row = 0usize;
    for degree in 1..=order {
        let degree_total = nr_multicombinations(nr_tau, degree)
            - if degree > 1 {
                nr_multicombinations(nr_tau, degree - 1)
            } else {
                0
            };

        let start_row = row;
        for slot in (order - degree)..order {
            table[row][slot] = 1;
        }

        for _ in 1..degree_total {
            let previous = table[row].clone();
            row += 1;
            table[row] = previous;
            let mut updated = false;
            for index in 0..order {
                if table[row][index] == nr_tau {
                    let replacement = if index == 0 {
                        1
                    } else {
                        table[row][index - 1] + 1
                    };
                    for slot in index.saturating_sub(1)..order {
                        table[row][slot] = replacement;
                    }
                    updated = true;
                    break;
                }
            }
            if !updated {
                let last = order - 1;
                table[row][last] += 1;
            }
        }
        row += 1;
        if row == start_row + degree_total {
            continue;
        }
    }
    table
}

pub(crate) fn select_model_terms(
    monomials: &[Vec<usize>],
    model_terms: &[i32],
    delays: &[usize],
) -> Result<Vec<Vec<usize>>> {
    let mut selected = Vec::with_capacity(model_terms.len());
    for term in model_terms {
        if *term <= 0 {
            return Err(DDAError::InvalidParameter(format!(
                "Model terms are 1-based, got {}",
                term
            )));
        }
        let row = monomials
            .get((*term as usize) - 1)
            .ok_or_else(|| {
                DDAError::InvalidParameter(format!(
                    "Model term {} is out of range for the configured monomial table",
                    term
                ))
            })?
            .iter()
            .filter_map(|entry| {
                if *entry == 0 {
                    None
                } else {
                    Some(delays[*entry - 1])
                }
            })
            .collect::<Vec<_>>();
        selected.push(row);
    }
    Ok(selected)
}
