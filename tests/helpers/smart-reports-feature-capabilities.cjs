'use strict';
// Native public2.4 response shape; only fixture data, never a client-side permission policy.
function featureCapabilities(admin=false,revision=0){return {status:'ready',revision,energy_model_schema:'ha_tools.energy_report/1',capabilities:{
 energy_analysis:{visible:true,read:true},energy_tariff:{visible:true,read:true,execute:admin},
 energy_reports:{visible:admin,read:admin,execute:admin},log_reports:{visible:admin,read:admin,execute:admin}}};}
module.exports={featureCapabilities};
